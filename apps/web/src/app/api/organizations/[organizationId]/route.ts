import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { renameOrganization as renameOrganizationContract } from "@/lib/contracts";
import { renameOrganization } from "@/lib/organizations";
import { unauthenticated, validationFailed } from "@/lib/errors";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const error = unauthenticated();
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const { organizationId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  // `organizationId` du chemin fait autorite : le corps peut le repeter
  // (forme du contrat, docs/02-architecture/api-contracts/organizations.ts)
  // mais ne peut jamais le contredire pour cibler une autre ressource.
  const candidate = {
    ...(typeof body === "object" && body !== null ? body : {}),
    organizationId,
  };
  const parsed = renameOrganizationContract.input.safeParse(candidate);
  if (!parsed.success) {
    const error = validationFailed(parsed.error.message);
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const result = await renameOrganization({
    userId: session.user.id,
    organizationId: parsed.data.organizationId,
    name: parsed.data.name,
  });
  if (!result.ok) {
    return NextResponse.json(
      { code: result.error.code, message: result.error.message },
      { status: result.error.status },
    );
  }

  return NextResponse.json(result.value, { status: 200 });
}
