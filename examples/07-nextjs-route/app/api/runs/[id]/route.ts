import { handlers } from "../../../../lib/machine.ts";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return (await handlers()).get(request, id);
}
