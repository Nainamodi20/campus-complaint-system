import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getStaffComplaints } from "./lib/api";
import "./App.css";

type Role = "student" | "faculty" | "maintenance" | "admin";

type Profile = {
  id: string;
  full_name: string;
  role: Role;
  department: string | null;
  registration_no: string | null;
};

type MaintenanceStaff = {
  id: string;
  full_name: string;
  department: string | null;
};

type Category = "electrical" | "mechanical" | "plumbing" | "infrastructure";

type ComplaintStatus =
  | "submitted"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "closed"
  | "reopened";

type Complaint = {
  id: string;
  complaint_number: string;
  title: string;
  description: string;
  category: Category;
  location_name: string;
  priority: "low" | "medium" | "high" | "urgent";
  submitted_by: string;
  assigned_to: string | null;
  status: ComplaintStatus;
  created_at: string;
};

type StatusHistory = {
  id: number;
  complaint_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
};

const emptyForm = {
  title: "",
  description: "",
  category: "infrastructure" as Category,
  location_name: "",
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [demoLoggedIn, setDemoLoggedIn] = useState(false);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [staffComplaints, setStaffComplaints] = useState<Complaint[]>([]);
  const [maintenanceStaff, setMaintenanceStaff] = useState<MaintenanceStaff[]>(
    [],
  );

  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(
    null,
  );
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);

  const [selectedStaffByComplaint, setSelectedStaffByComplaint] = useState<
    Record<string, string>
  >({});
  const [assignmentNotesByComplaint, setAssignmentNotesByComplaint] = useState<
    Record<string, string>
  >({});

  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffListLoading, setStaffListLoading] = useState(false);
  const [assigningComplaintId, setAssigningComplaintId] = useState<
    string | null
  >(null);

  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registrationRole, setRegistrationRole] = useState<
    "student" | "faculty"
  >("student");

  const [registrationNo, setRegistrationNo] = useState("");
  const [form, setForm] = useState(emptyForm);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadStaffDashboard(accessToken: string) {
    setStaffLoading(true);

    try {
      const data = await getStaffComplaints(accessToken);
      setStaffComplaints(data as Complaint[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load staff complaints.",
      );
    } finally {
      setStaffLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadDashboard(userId: string) {
      const [profileResult, complaintResult] = await Promise.all([
supabase
  .from("profiles")
  .select("id, full_name, role, department, registration_no")
  .eq("id", userId)
  .maybeSingle(),

        supabase
          .from("complaints")
          .select(
            "id, complaint_number, title, description, category, location_name, priority, status, submitted_by, assigned_to, created_at",
          )
          .eq("submitted_by", userId)
          .order("created_at", { ascending: false }),
      ]);

      if (!active) return;

      if (profileResult.error) {
        setError(`Profile error: ${profileResult.error.message}`);
      } else {
        setProfile(profileResult.data as Profile | null);
      }

      if (complaintResult.error) {
        setError(`Complaint loading error: ${complaintResult.error.message}`);
      } else {
        setComplaints((complaintResult.data ?? []) as Complaint[]);
      }

      if (
        !profileResult.error &&
        profileResult.data &&
        ["admin", "maintenance"].includes(profileResult.data.role)
      ) {
        await loadStaffDashboard(
          (await supabase.auth.getSession()).data.session?.access_token ?? "",
        );
      } else {
        setStaffComplaints([]);
      }
    }

    async function initialize() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (!active) return;

        if (sessionError) {
          setError(sessionError.message);
        }

        setSession(data.session);

        if (data.session) {
          await loadDashboard(data.session.user.id);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to initialize your account.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setMessage("");
      setError("");

      if (!newSession) {
        setProfile(null);
        setComplaints([]);
        setStaffComplaints([]);
        setMaintenanceStaff([]);
        setSelectedComplaint(null);
        return;
      }

      // Run database requests after the authentication callback finishes.
      setTimeout(() => {
        if (active) {
          void loadDashboard(newSession.user.id);
        }
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (demoLoggedIn) {
      return;
    }

    if (profile?.role !== "admin") {
      setMaintenanceStaff([]);
      return;
    }

    let active = true;

    async function loadMaintenanceStaff() {
      setStaffListLoading(true);

      const { data, error: staffError } = await supabase
        .from("profiles")
        .select("id, full_name, department")
        .eq("role", "maintenance")
        .order("full_name");

      if (!active) return;

      if (staffError) {
        setError(`Could not load maintenance staff: ${staffError.message}`);
      } else {
        setMaintenanceStaff((data ?? []) as MaintenanceStaff[]);
      }

      setStaffListLoading(false);
    }

    void loadMaintenanceStaff();

    return () => {
      active = false;
    };
  }, [profile?.role, demoLoggedIn]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (isRegistering) {
      const normalizedName = fullName.trim();
      const normalizedRegNo = registrationNo.trim();

      if (!normalizedName) {
        setError("Please enter your full name.");
        return;
      }

      if (password.length < 6) {
        setError("Password must contain at least 6 characters.");
        return;
      }

      if (
        registrationRole === "student" &&
        !/^RA[A-Za-z0-9]{13}$/.test(normalizedRegNo)
      ) {
        setError(
          "Enter a valid student registration number: RA followed by 13 letters or digits (15 characters total).",
        );
        return;
      }

      try {
        const { data, error: authError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              full_name: normalizedName,
              role: registrationRole,
              registration_no:
                registrationRole === "student" ? normalizedRegNo : null,
            },
          },
        });

        if (authError) {
          setError(authError.message);
          return;
        }

        setFullName(normalizedName);
        setRegistrationNo("");

        if (data.session) {
          setMessage("Account created successfully.");
        } else {
          setMessage(
            "Account created. If email confirmation is enabled in Supabase, confirm your email before logging in.",
          );
        }

        setIsRegistering(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed.");
      }

      return;
    }

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      setMessage("Login successful.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  }

  async function handleLogout() {
    setError("");
    setMessage("");

    if (session) {
      const { error: logoutError } = await supabase.auth.signOut();
      if (logoutError) {
        setError(logoutError.message);
        return;
      }
    }

    setDemoLoggedIn(false);
    setSession(null);
    setProfile(null);
    setComplaints([]);
    setStaffComplaints([]);
    setMaintenanceStaff([]);
    setSelectedComplaint(null);
    setStatusHistory([]);
    setPassword("");
  }

  async function handleComplaintSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!session && demoLoggedIn) {
      const demoComplaint: Complaint = {
        id: `demo-${Date.now()}`,
        complaint_number: `CMP-DEMO-${String(Date.now()).slice(-6)}`,
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        location_name: form.location_name.trim(),
        priority: "medium",
        submitted_by: profile?.id ?? "demo-student",
        assigned_to: null,
        status: "submitted",
        created_at: new Date().toISOString(),
      };
      setComplaints((current) => [demoComplaint, ...current]);
      setForm(emptyForm);
      setMessage(
        `Demo complaint ${demoComplaint.complaint_number} added locally. It was not saved to Supabase.`,
      );
      return;
    }

    if (!session) {
      setError("Please log in before submitting a complaint.");
      return;
    }

    setSubmitting(true);

    try {
      const { data, error: insertError } = await supabase
        .from("complaints")
        .insert({
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          location_name: form.location_name.trim(),
          priority: "medium",
          status: "submitted",
          submitted_by: session.user.id,
          assigned_to: null,
        })
        .select(
          "id, complaint_number, title, description, category, location_name, priority, status, submitted_by, assigned_to, created_at",
        )
        .single();

      if (insertError) {
        throw insertError;
      }

      setComplaints((current) => [data as Complaint, ...current]);
      setForm(emptyForm);
      setMessage(
        `Complaint submitted successfully. Reference: ${
          (data as Complaint).complaint_number
        }`,
      );
    } catch (err) {
      setError(
        `Could not submit complaint: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewDetails(complaint: Complaint) {
    setSelectedComplaint(complaint);
    setStatusHistory([]);
    setHistoryLoading(true);
    setError("");

    if (demoLoggedIn) {
      setStatusHistory([
        {
          id: 1,
          complaint_id: complaint.id,
          old_status: null,
          new_status: complaint.status,
          changed_by: profile?.id ?? null,
          notes: "Sample demo status history. This is not a database record.",
          created_at: complaint.created_at,
        },
      ]);
      setHistoryLoading(false);
      return;
    }

    try {
      const { data, error: historyError } = await supabase
        .from("complaint_status_history")
        .select(
          "id, complaint_id, old_status, new_status, changed_by, notes, created_at",
        )
        .eq("complaint_id", complaint.id)
        .order("created_at", { ascending: true });

      if (historyError) {
        throw historyError;
      }

      setStatusHistory((data ?? []) as StatusHistory[]);
    } catch (err) {
      setError(
        `Could not load status history: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleAssignComplaint(complaint: Complaint) {
    if (demoLoggedIn) {
      setMessage(
        "Demo mode: assignment changes are not saved. Log in with a real admin account to assign complaints in the database.",
      );
      return;
    }

    if (profile?.role !== "admin") {
      setError("Only admins can assign complaints.");
      return;
    }

    const staffId = selectedStaffByComplaint[complaint.id];

    if (!staffId) {
      setError("Please select a maintenance staff member.");
      return;
    }

    if (!session) {
      setError("Your session has expired. Please log in again.");
      return;
    }

    setAssigningComplaintId(complaint.id);
    setError("");
    setMessage("");

    try {
      const { error: assignmentError } = await supabase.rpc(
        "assign_complaint",
        {
          p_complaint_id: complaint.id,
          p_staff_id: staffId,
          p_notes: assignmentNotesByComplaint[complaint.id]?.trim() || null,
        },
      );

      if (assignmentError) {
        throw assignmentError;
      }

      setMessage(
        `${complaint.complaint_number} was ${
          complaint.assigned_to ? "reassigned" : "assigned"
        } successfully.`,
      );

      await loadStaffDashboard(session.access_token);
    } catch (err) {
      setError(
        `Assignment failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setAssigningComplaintId(null);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p>Loading your account...</p>
      </main>
    );
  }

  if (!session && !demoLoggedIn) {
    return (
      <main className="page">
        <section className="panel">
          <p className="eyebrow">CAMPUS COMPLAINT MANAGEMENT</p>
          <h1>{isRegistering ? "Create your account" : "Welcome back"}</h1>
          <p className="muted">
            {isRegistering
              ? "Register to report and track campus issues."
              : "Log in to manage your campus complaints."}
          </p>

          <form onSubmit={handleAuth}>
            {isRegistering && (
              <label>
                Full name
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
            )}

            {isRegistering && (
              <>
                <label>
                  Account type
                  <select
                    value={registrationRole}
                    onChange={(event) =>
                      setRegistrationRole(
                        event.target.value as "student" | "faculty",
                      )
                    }
                    required
                  >
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                  </select>
                </label>

                {registrationRole === "student" && (
                  <label>
                    Student registration number
                    <input
                      value={registrationNo}
                      onChange={(event) =>
                        setRegistrationNo(event.target.value.toUpperCase())
                      }
                      placeholder="e.g. RA1234567890123"
                      minLength={15}
                      maxLength={15}
                      pattern="RA[A-Za-z0-9]{13}"
                      title="Enter RA followed by exactly 13 letters or digits."
                      autoComplete="off"
                      required
                    />
                  </label>
                )}
              </>
            )}

            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  isRegistering ? "new-password" : "current-password"
                }
                required
              />
            </label>

            {error && <p className="error">{error}</p>}
            {message && <p className="success">{message}</p>}

            <button className="primary" type="submit">
              {isRegistering ? "Create account" : "Log in"}
            </button>
          </form>

          <p className="switch-mode">
            {isRegistering
              ? "Already have an account?"
              : "New to the campus portal?"}{" "}
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setIsRegistering((current) => !current);
                setMessage("");
                setError("");
              }}
            >
              {isRegistering ? "Log in" : "Register"}
            </button>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">CAMPUS RESOLVE</p>
          <h1>
            {profile?.role === "student"
              ? "Student Dashboard"
              : profile?.role === "faculty"
                ? "Faculty Dashboard"
                : profile?.role === "maintenance"
                  ? "Maintenance Dashboard"
                  : profile?.role === "admin"
                    ? "Admin Dashboard"
                    : "Loading dashboard..."}
          </h1>
          {profile?.role === "student" && (
  <p className="muted">
    Registration No: {profile.registration_no || "Not available"}
  </p>
)}
        </div>
      </header>

      <section className="welcome">
        <div>
          <h2>
            Hello,{" "}
            {profile?.full_name || session?.user.email || email || "Demo User"}
          </h2>
          <p className="muted">
            {profile?.role === "student"
              ? "Report a campus issue and follow its progress here."
              : profile?.role === "admin"
                ? "Manage complaints and assign maintenance work."
                : profile?.role === "maintenance"
                  ? "Review and manage your assigned maintenance work."
                  : "Review campus complaints and follow their progress."}
          </p>
        </div>

        <span className="role">{profile?.role ?? "Role loading"}</span>
        {profile?.role === "student" && (
  <p className="muted">
    Registration number:{" "}
    <strong>{profile.registration_no || "Not available"}</strong>
  </p>
)}

        <button type="button" onClick={handleLogout}>
          Logout
        </button>
      </section>
      {error && <p className="error notice">{error}</p>}
      {message && <p className="success notice">{message}</p>}

      {profile && profile.role !== "student" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>
                {profile.role === "admin"
                  ? "Complaint Management Queue"
                  : "My Assigned Complaints"}
              </h2>
              <p className="muted">
                {staffComplaints.length} complaint
                {staffComplaints.length === 1 ? "" : "s"} available
              </p>
            </div>

            <button
              className="secondary"
              type="button"
              onClick={() =>
                session
                  ? void loadStaffDashboard(session.access_token)
                  : setMessage("Demo mode: showing sample complaints only.")
              }
              disabled={staffLoading}
            >
              {staffLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {staffLoading ? (
            <p className="muted">Loading complaints...</p>
          ) : staffComplaints.length === 0 ? (
            <p className="empty-state">
              No complaints are currently available in this queue.
            </p>
          ) : (
            <div className="complaint-list">
              {staffComplaints.map((complaint) => (
                <article className="complaint-card" key={complaint.id}>
                  <div className="complaint-card-top">
                    <span className="complaint-number">
                      {complaint.complaint_number}
                    </span>
                    <span className={`status status-${complaint.status}`}>
                      {complaint.status.replace("_", " ")}
                    </span>
                  </div>

                  <h3>{complaint.title}</h3>
                  <p className="muted">{complaint.description}</p>

                  <div className="complaint-meta">
                    <span>{complaint.category}</span>
                    <span>{complaint.location_name}</span>
                    <span>Priority: {complaint.priority}</span>
                  </div>

                  {profile.role === "admin" && (
                    <div className="assignment-controls">
                      <label>
                        Assign maintenance staff
                        <select
                          value={selectedStaffByComplaint[complaint.id] ?? ""}
                          onChange={(event) =>
                            setSelectedStaffByComplaint((current) => ({
                              ...current,
                              [complaint.id]: event.target.value,
                            }))
                          }
                          disabled={
                            assigningComplaintId !== null || staffListLoading
                          }
                        >
                          <option value="">
                            {staffListLoading
                              ? "Loading staff..."
                              : "Select staff member"}
                          </option>

                          {maintenanceStaff.map((staff) => (
                            <option key={staff.id} value={staff.id}>
                              {staff.full_name}
                              {staff.department ? ` — ${staff.department}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>

                      {!staffListLoading && maintenanceStaff.length === 0 && (
                        <p className="muted">
                          No maintenance staff profiles were found.
                        </p>
                      )}

                      <label>
                        Assignment notes
                        <input
                          value={assignmentNotesByComplaint[complaint.id] ?? ""}
                          onChange={(event) =>
                            setAssignmentNotesByComplaint((current) => ({
                              ...current,
                              [complaint.id]: event.target.value,
                            }))
                          }
                          placeholder="Optional instructions"
                          maxLength={1000}
                        />
                      </label>

                      <button
                        className="primary"
                        type="button"
                        onClick={() => void handleAssignComplaint(complaint)}
                        disabled={
                          assigningComplaintId !== null ||
                          staffListLoading ||
                          maintenanceStaff.length === 0
                        }
                      >
                        {assigningComplaintId === complaint.id
                          ? "Assigning..."
                          : complaint.assigned_to
                            ? "Reassign complaint"
                            : "Assign complaint"}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {(profile?.role === "student" ||
  profile?.role === "faculty") && (
  <div className="dashboard-grid">
          <section className="panel">
            <h2>Submit a complaint</h2>
            <p className="muted">
              Provide enough detail to help the maintenance team resolve the
              issue.
            </p>

            <form onSubmit={handleComplaintSubmit}>
              <label>
                Complaint title
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  placeholder="e.g. Broken light in classroom"
                  maxLength={150}
                  required
                />
              </label>

              <label>
                Category
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      category: event.target.value as Category,
                    })
                  }
                  required
                >
                  <option value="electrical">Electrical</option>
                  <option value="mechanical">Mechanical</option>
                  <option value="plumbing">Plumbing</option>
                  <option value="infrastructure">Infrastructure</option>
                </select>
              </label>

              <label>
                Campus location
                <input
                  value={form.location_name}
                  onChange={(event) =>
                    setForm({ ...form, location_name: event.target.value })
                  }
                  placeholder="e.g. Block A, Room 204"
                  maxLength={200}
                  required
                />
              </label>

              <label>
                Description
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  placeholder="Describe the problem and when you noticed it."
                  rows={5}
                  maxLength={5000}
                  required
                />
              </label>

              <button className="primary" type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit complaint"}
              </button>
            </form>
          </section>

          <section className="panel complaints-panel">
            <div className="section-heading">
              <div>
                <h2>My complaints</h2>
                <p className="muted">
                  {complaints.length} complaint
                  {complaints.length === 1 ? "" : "s"} submitted
                </p>
              </div>
            </div>

            {complaints.length === 0 ? (
              <p className="empty-state">
                You haven't submitted any complaints yet.
              </p>
            ) : (
              <div className="complaint-list">
                {complaints.map((complaint) => (
                  <article className="complaint-card" key={complaint.id}>
                    <div className="complaint-card-top">
                      <span className="complaint-number">
                        {complaint.complaint_number}
                      </span>
                      <span className={`status status-${complaint.status}`}>
                        {complaint.status.replace("_", " ")}
                      </span>
                    </div>

                    <h3>{complaint.title}</h3>
                    <p className="muted">{complaint.description}</p>

                    <button
                      className="secondary details-button"
                      type="button"
                      onClick={() => void handleViewDetails(complaint)}
                    >
                      View details
                    </button>

                    <div className="complaint-meta">
                      <span>{complaint.category}</span>
                      <span>{complaint.location_name}</span>
                      <span>
                        {new Date(complaint.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {selectedComplaint && (
            <section className="panel details-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">COMPLAINT DETAILS</p>
                  <h2>{selectedComplaint.complaint_number}</h2>
                </div>

                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setSelectedComplaint(null);
                    setStatusHistory([]);
                    setError("");
                  }}
                >
                  Close details
                </button>
              </div>

              <h3>{selectedComplaint.title}</h3>
              <p>{selectedComplaint.description}</p>

              <div className="complaint-meta">
                <span>Category: {selectedComplaint.category}</span>
                <span>Location: {selectedComplaint.location_name}</span>
                <span>Priority: {selectedComplaint.priority}</span>
              </div>

              <p>
                Current status:{" "}
                <strong>{selectedComplaint.status.replace("_", " ")}</strong>
              </p>

              <h3>Status timeline</h3>

              {historyLoading ? (
                <p className="muted">Loading status history...</p>
              ) : statusHistory.length === 0 ? (
                <p className="empty-state">
                  No status history is available for this complaint.
                </p>
              ) : (
                <ol className="status-timeline">
                  {statusHistory.map((item) => (
                    <li key={item.id} className="timeline-item">
                      <div className="timeline-marker" />

                      <div>
                        <strong>
                          {item.old_status
                            ? `${item.old_status.replace("_", " ")} → `
                            : ""}
                          {item.new_status.replace("_", " ")}
                        </strong>

                        <p className="muted timeline-date">
                          {new Date(item.created_at).toLocaleString()}
                        </p>

                        {item.notes && <p>{item.notes}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

export default App;
