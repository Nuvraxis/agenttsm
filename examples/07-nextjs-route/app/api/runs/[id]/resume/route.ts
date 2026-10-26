import { handlers } from "../../../../../lib/machine.ts";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/runs/[id]/resume">,
): Promise<Response> {
  const { id } = await ctx.params;
  return (await handlers()).resume(request, id);
}
