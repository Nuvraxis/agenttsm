import { handlers } from "../../../lib/machine.ts";

export async function POST(request: Request): Promise<Response> {
  return (await handlers()).start(request);
}
