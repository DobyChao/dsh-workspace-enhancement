/**
 * Wire identity and envelope adapter of this plugin's browser channel.
 *
 * WHY THIS MODULE EXISTS: the host half used to mount a standalone `/dsw`
 * channel through `connection.rpc.handle`. That API is unusable on the 0.1.5
 * line — `dsh-client-connection`'s `register()` ends in `owner.webServer.register(route)`
 * where `owner` is the Connection service's OWN context, which no longer injects
 * `webServer` (it declares `["credentials"]` alone) — so the registration threw
 * on every host family we support and `/dsw` answered 405 (UPSTREAM-3 F1/F2, see
 * `docs/rounds/R18-F2-dsw-405.md`).
 *
 * The channel therefore rides the OFFICIAL shared transport instead: exact Fetch
 * routes on `/api` (`connection.fetch.register`, the seam
 * `@deepseek-ai/dsh-client-file-upload` uses). Exact routes are matched BEFORE
 * the shared channel's interceptor, which `@deepseek-ai/dsh-api-gateway` already
 * owns (`registerInterceptor` allows exactly one owner per channel), and they
 * keep the same envelope, so the client half keeps calling one unary endpoint at
 * a time. The physical carrier still applies the loopback/Host fence and the
 * browser-session check before our handler runs.
 *
 * BOTH halves import this module, so the path, the namespace and the envelope
 * cannot drift apart (the previous design hard-coded '/dsw' in three places).
 * @module dsh-workspace-enhancement/web-channel
 */

/** The shared browser transport channel (`dsh-client-connection`'s `API_PATH`). */
export const API_CHANNEL = '/api'

/** This row's namespace below {@link API_CHANNEL}. */
export const CHANNEL_NAMESPACE = 'dsw'

/** Endpoint spelling on the wire: what the client passes to `rpc.call`. */
export function channelEndpointOf(endpoint: string): string {
  return `${CHANNEL_NAMESPACE}/${endpoint}`
}

/** Absolute request path of one endpoint: what the host registers. */
export function channelPathOf(endpoint: string): string {
  return `${API_CHANNEL}/${channelEndpointOf(endpoint)}`
}

/** The unary RPC result shape the shared transport expects. */
export type ChannelResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }

/** One endpoint handler: the `dispatch` switch in `./web.ts`. */
export type ChannelDispatch = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<ChannelResult>

/** One exact Fetch route, shaped like `ConnectionFetchRoute` (upstream `lib/types/rpc.d.ts`). */
export interface ChannelRoute {
  /** Absolute path below `/api`. */
  readonly path: string
  /** Methods this route owns. */
  readonly methods: readonly ['POST']
  /** JSON envelopes are small: the configured aggregate body cap applies. */
  readonly requestBody: 'buffered'
  /** Handle one authenticated request. */
  fetch(request: Request): Promise<Response>
}

/** Upstream's error code for a malformed envelope. */
const BAD_REQUEST = 'gateway/bad-request'

/** `rpcId` echoed when the request did not carry a usable one. */
const INVALID_REQUEST_RPC_ID = 'invalid-request'

/**
 * `true` when an error is the registry's own duplicate-path rejection.
 *
 * `connection.fetch.register` runs inside the CONNECTION service's effect scope,
 * so a plugin reload that does not dispose the Connection service leaves the
 * previous route in place and the second registration throws. That is not a
 * failure: the route object is stateless and resolves the live dispatch per
 * request (see {@link channelRouteOf}), so the surviving registration already
 * serves the newest handler.
 */
export function isAlreadyRegistered(error: unknown): boolean {
  return error instanceof Error && error.message.includes('is already registered')
}

/** One validated client envelope. */
interface ClientEnvelope {
  rpcId: string
  method: string
  payload: unknown
}

/** Parse `{type:"client-request", rpcId, method, payload?}`, mirroring upstream's schema. */
function clientEnvelopeOf(body: unknown): ClientEnvelope | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (record.type !== 'client-request') return undefined
  if (typeof record.rpcId !== 'string' || record.rpcId === '') return undefined
  if (typeof record.method !== 'string' || record.method === '') return undefined
  return { rpcId: record.rpcId, method: record.method, payload: record.payload }
}

/** One `server-response` envelope carrying an error result. */
function envelopeError(rpcId: unknown, message: string): Response {
  return Response.json({
    type: 'server-response',
    rpcId: typeof rpcId === 'string' && rpcId !== '' ? rpcId : INVALID_REQUEST_RPC_ID,
    result: { ok: false, error: { code: BAD_REQUEST, message, details: { issues: [] } } },
  })
}

/**
 * Build the exact Fetch route of one endpoint.
 *
 * The route is STATELESS: it resolves the dispatch through `resolve` on every
 * request, so a reload that cannot re-register the path (see
 * {@link isAlreadyRegistered}) still runs the newest host code.
 * @param endpoint - endpoint name without the namespace (e.g. `connections.list`).
 * @param resolve - live dispatch lookup for `endpoint`.
 * @returns the route to hand to `connection.fetch.register`.
 */
export function channelRouteOf(
  endpoint: string,
  resolve: (endpoint: string) => ChannelDispatch | undefined,
): ChannelRoute {
  // The envelope carries the endpoint path BELOW the channel — the same string
  // the client passes to `rpc.call` and the same one upstream compares against
  // (`endpointFromPath(channel, pathname)`), so `dsw/connections.list` here and
  // not the bare switch label.
  const wireEndpoint = channelEndpointOf(endpoint)
  return {
    path: channelPathOf(endpoint),
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') return new Response('not found', { status: 404 })
      const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      const envelope = clientEnvelopeOf(body)
      if (envelope === undefined) {
        return envelopeError((body as Record<string, unknown> | null)?.rpcId, 'invalid client-request message')
      }
      if (envelope.method !== wireEndpoint) {
        return envelopeError(
          envelope.rpcId,
          `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(wireEndpoint)}`,
        )
      }
      const dispatch = resolve(endpoint)
      if (dispatch === undefined) return new Response('not found', { status: 404 })
      try {
        const result = await dispatch(endpoint, envelope.payload, request.signal)
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}
