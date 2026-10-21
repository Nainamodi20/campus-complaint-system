const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:5000";

export async function getStaffComplaints(accessToken: string) {
  const response = await fetch(`${API_URL}/api/staff/complaints`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error ?? "Unable to load staff complaints."
    );
  }

  return result.complaints;
}