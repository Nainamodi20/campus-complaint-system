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
};

type Category = "electrical" | "mechanical" | "plumbing" | "infrastructure";

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
  status:
    | "submitted"
    | "assigned"
    | "in_progress"
    | "resolved"
    | "closed"
    | "reopened";
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
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(
    null,
  );

  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [staffComplaints, setStaffComplaints] = useState<Complaint[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [form, setForm] = useState(emptyForm);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDashboard(userId: string) {
      const [profileResult, complaintResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, role, department")
          .eq("id", userId)
          .maybeSingle(),

        supabase
          .from("complaints")
          .select(
            "id, complaint_number, title, description, category, location_name, priority, status, created_at",
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
    }

    async function initialize() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

      if (error) setError(error.message);

      setSession(data.session);

      if (data.session) {
        await loadDashboard(data.session.user.id);

        const { data: profileData } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.session.user.id)
          .maybeSingle();

        if (
          profileData &&
          ["faculty", "maintenance", "admin"].includes(profileData.role)
        ) {
          // The staff dashboard is loaded after the effect has access
          // to the current session token.
          const response = await getStaffComplaints(data.session.access_token);
          if (active) {
            setStaffComplaints(response as Complaint[]);
          }
        }
      }

      if (active) setLoading(false);
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
        return;
      }

      // Defer database requests until the auth callback has finished.
      setTimeout(() => {
        if (active) void loadDashboard(newSession.user.id);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadStaffDashboard(accessToken: string) {
    setStaffLoading(true);
    setError("");

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

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (isRegistering) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() },
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      if (!data.session) {
        setMessage("Registration successful. Confirm your email, then log in.");
      } else {
        setMessage("Account created successfully.");
      }

      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Login successful.");
  }

  async function handleLogout() {
    setError("");
    setMessage("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setError(error.message);
      return;
    }

    setProfile(null);
    setComplaints([]);
  }

  async function handleComplaintSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!session) {
      setError("Please log in before submitting a complaint.");
      return;
    }

    setSubmitting(true);

    const { data, error } = await supabase
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
        "id, complaint_number, title, description, category, location_name, priority, status, created_at",
      )
      .single();

    setSubmitting(false);

    if (error) {
      setError(`Could not submit complaint: ${error.message}`);
      return;
    }

    setComplaints((current) => [data as Complaint, ...current]);
    setForm(emptyForm);
    setMessage(
      `Complaint submitted successfully. Reference: ${
        (data as Complaint).complaint_number
      }`,
    );
  }

  if (loading) {
    return (
      <main className="page">
        <p>Loading your account...</p>
      </main>
    );
  }

  async function handleViewDetails(complaint: Complaint) {
    setSelectedComplaint(complaint);
    setStatusHistory([]);
    setHistoryLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("complaint_status_history")
      .select(
        "id, complaint_id, old_status, new_status, changed_by, notes, created_at",
      )
      .eq("complaint_id", complaint.id)
      .order("created_at", { ascending: true });

    setHistoryLoading(false);

    if (error) {
      setError(`Could not load status history: ${error.message}`);
      return;
    }

    setStatusHistory((data ?? []) as StatusHistory[]);
  }

  if (!session) {
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
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
            )}

            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  isRegistering ? "new-password" : "current-password"
                }
                minLength={6}
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
                setIsRegistering(!isRegistering);
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
          <p className="eyebrow">CAMPUS COMPLAINT MANAGEMENT</p>
          <h1>
            {profile?.role === "student"
              ? "Student Dashboard"
              : profile?.role === "faculty"
                ? "Faculty Dashboard"
                : profile?.role === "maintenance"
                  ? "Maintenance Dashboard"
                  : "Admin Dashboard"}
          </h1>
        </div>
        <button className="secondary" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <section className="welcome">
        <div>
          <h2>Hello, {profile?.full_name || session.user.email}</h2>
          <p className="muted">
            Report a campus issue and follow its progress here.
          </p>
        </div>
        <span className="role">{profile?.role ?? "Role loading"}</span>
      </section>

      {error && <p className="error notice">{error}</p>}
      {message && <p className="success notice">{message}</p>}
      {profile && profile.role !== "student" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Staff Complaint Queue</h2>
              <p className="muted">
                {staffComplaints.length} complaint
                {staffComplaints.length === 1 ? "" : "s"} available
              </p>
            </div>

            <button
              className="secondary"
              type="button"
              onClick={() => void loadStaffDashboard(session.access_token)}
              disabled={staffLoading}
            >
              {staffLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {staffLoading ? (
            <p className="muted">Loading complaints...</p>
          ) : staffComplaints.length === 0 ? (
            <p className="empty-state">
              No assigned complaints are currently available.
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
                </article>
              ))}
            </div>
          )}
        </section>
      )}

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
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Broken light in classroom"
                maxLength={150}
                required
              />
            </label>

            <label>
              Category
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value as Category,
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
                onChange={(e) =>
                  setForm({ ...form, location_name: e.target.value })
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
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
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
    </main>
  );
}

export default App;
