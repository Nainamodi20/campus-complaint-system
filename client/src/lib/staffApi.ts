const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:5000";

export type StaffMember = {
  id: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
  created_at?: string;
};

async function staffRequest<T>(
  path: string,
  accessToken: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error ?? "Staff request failed.");
  }

  return result as T;
}

export async function getStaff(accessToken: string) {
  return staffRequest<{ staff: StaffMember[] }>(
    "/api/admin/staff",
    accessToken
  );
}

export async function inviteStaff(
  accessToken: string,
  details: {
    full_name: string;
    email: string;
    department: string;
  }
) {
  return staffRequest<{
    message: string;
    staff: StaffMember;
  }>("/api/admin/staff", accessToken, "POST", details);
}

export async function updateStaff(
  accessToken: string,
  staffId: string,
  changes: {
    full_name?: string;
    department?: string;
    is_active?: boolean;
  }
) {
  return staffRequest<{
    message: string;
    staff: StaffMember;
  }>(
    `/api/admin/staff/${encodeURIComponent(staffId)}`,
    accessToken,
    "PATCH",
    changes
  );
}