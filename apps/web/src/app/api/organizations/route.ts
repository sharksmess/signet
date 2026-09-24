import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOrganization as createOrganizationContract } from "@/lib/contracts";
import { createOrganization } from "@/lib/organizations";
import { unauthenticated, validationFailed } from "@/lib/errors";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const error = unauthenticated();
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = createOrganizationContract.input.safeParse(body);
  if (!parsed.success) {
    const error = validationFailed(parsed.error.message);
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const result = await createOrganization(session.user.id, parsed.data.name);
  if (!result.ok) {
    return NextResponse.json(
      { code: result.error.code, message: result.error.message },
      { status: result.error.status },
    );
  }

  return NextResponse.json(result.value, { status: 201 });
}
