/**
 * GET /api/status — tiny edge endpoint (Cloudflare Pages Function / Worker).
 * Feeds the corner status panel with the serving edge location and build info.
 * All "telemetry" here is illustrative; nothing is read from a real aircraft.
 */
interface Env {
  BUILD_VERSION?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cf = (request as Request & { cf?: IncomingRequestCfProperties }).cf;
  const body = {
    system: 'K1000 DIGITAL TWIN',
    status: 'online',
    version: env.BUILD_VERSION ?? '1.0.0',
    edge: cf?.colo ?? 'LOCAL',
    country: cf?.country ?? null,
    time: new Date().toISOString(),
    illustrative: true,
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
