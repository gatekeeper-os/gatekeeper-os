export async function status(_args: string[]): Promise<number> {
  // TODO(phase-1): probe /healthz,/startupz,/readyz; systemctl --user status; lockfile vs `openclaw --version`; then os.status over WS.
  console.log(JSON.stringify({ healthy: false, todo: "phase-1" }));
  return 1;
}
