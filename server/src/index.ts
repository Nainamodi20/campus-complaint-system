import "dotenv/config";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Add basic security headers.
app.use(helmet());

// Allow requests from our local React frontend.
app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:5173",
  })
);

// Allow the server to read JSON request bodies.
app.use(express.json());

// Health-check endpoint.
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Campus Complaint Management API is running",
  });
});
app.get("/api/health/supabase", async (_req, res) => {
  try {
    const { error } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Supabase check failed:", error.message);

      res.status(503).json({
        status: "error",
        message: "Supabase connection check failed",
      });
      return;
    }

    res.status(200).json({
      status: "ok",
      message: "Backend connected to Supabase",
    });
  } catch (error) {
    console.error("Supabase check failed:", error);

    res.status(503).json({
      status: "error",
      message: "Supabase connection check failed",
    });
  }
});


// Start the server.
// Get complaints visible to authorized staff.
app.get("/api/staff/complaints", async (req, res) => {
  try {
    // 1. Read the access token sent by the frontend.
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        error: "Authentication required",
      });
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();

    // 2. Create a Supabase client scoped to this user's token.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({
        error: "Server configuration error",
      });
      return;
    }

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // 3. Ask Supabase to verify the token.
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);

    if (authError || !user) {
      res.status(401).json({
        error: "Invalid or expired session",
      });
      return;
    }

    // 4. Read the user's actual role from the database.
    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Staff profile lookup failed:", profileError.message);

      res.status(500).json({
        error: "Unable to verify staff permissions",
      });
      return;
    }

    if (!profile) {
      res.status(403).json({
        error: "User profile not found",
      });
      return;
    }

    // 5. Students cannot use the staff endpoint.
    const staffRoles = ["faculty", "maintenance", "admin"];

    if (!staffRoles.includes(profile.role)) {
      res.status(403).json({
        error: "Staff access required",
      });
      return;
    }

    // 6. Retrieve complaints using the user's own database permissions.
    let query = userClient
      .from("complaints")
      .select(
        "id, complaint_number, title, description, category, location_name, priority, status, submitted_by, assigned_to, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    // Non-admin staff see only complaints assigned to them.
    if (profile.role !== "admin") {
      query = query.eq("assigned_to", user.id);
    }

    const { data: complaints, error: complaintsError } = await query;

    if (complaintsError) {
      console.error(
        "Staff complaints query failed:",
        complaintsError.message
      );

      res.status(500).json({
        error: "Unable to retrieve complaints",
      });
      return;
    }

    res.status(200).json({
      complaints,
    });
  } catch (error) {
    console.error("Staff complaints endpoint failed:", error);

    res.status(500).json({
      error: "Unexpected server error",
    });
  }
});

// Staff management: admin-only authentication check
async function getAdminId(req: import("express").Request) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length);

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return null;
  }

  const { data: profile, error: profileError } =
    await supabaseAdmin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", user.id)
      .maybeSingle();

  if (
    profileError ||
    !profile ||
    profile.role !== "admin" ||
    profile.is_active === false
  ) {
    return null;
  }

  return user.id;
}

// GET: list maintenance staff
app.get("/api/admin/staff", async (req, res) => {
  try {
    const adminId = await getAdminId(req);

    if (!adminId) {
      res.status(403).json({ error: "Admin access required." });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, department, is_active, created_at")
      .eq("role", "maintenance")
      .order("full_name");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ staff: data ?? [] });
  } catch {
    res.status(500).json({ error: "Unable to load staff." });
  }
});

// POST: invite a new maintenance staff member
app.post("/api/admin/staff", async (req, res) => {
  try {
    const adminId = await getAdminId(req);

    if (!adminId) {
      res.status(403).json({ error: "Admin access required." });
      return;
    }

    const fullName =
      typeof req.body.full_name === "string"
        ? req.body.full_name.trim()
        : "";

    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const department =
      typeof req.body.department === "string"
        ? req.body.department.trim()
        : "";

    if (!fullName || !email || !email.includes("@")) {
      res.status(400).json({
        error: "Enter a valid name and email address.",
      });
      return;
    }

    const { data: invitation, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
      });

    if (inviteError || !invitation.user) {
      res.status(400).json({
        error: inviteError?.message ?? "Unable to invite staff member.",
      });
      return;
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: invitation.user.id,
          full_name: fullName,
          role: "maintenance",
          department: department || null,
          is_active: true,
        },
        { onConflict: "id" }
      );

    if (profileError) {
      res.status(500).json({
        error:
          "The invitation was created, but the staff profile could not be saved. Check the profile table and try again.",
      });
      return;
    }

    res.status(201).json({
      message: "Staff invitation sent successfully.",
      staff: {
        id: invitation.user.id,
        full_name: fullName,
        department: department || null,
        is_active: true,
      },
    });
  } catch {
    res.status(500).json({ error: "Unable to invite staff member." });
  }
});

// PATCH: edit a staff member or activate/deactivate them
app.patch("/api/admin/staff/:id", async (req, res) => {
  try {
    const adminId = await getAdminId(req);

    if (!adminId) {
      res.status(403).json({ error: "Admin access required." });
      return;
    }

    const staffId = req.params.id;

    const updates: {
      full_name?: string;
      department?: string | null;
      is_active?: boolean;
    } = {};

    if (typeof req.body.full_name === "string") {
      const fullName = req.body.full_name.trim();

      if (!fullName) {
        res.status(400).json({ error: "Name cannot be empty." });
        return;
      }

      updates.full_name = fullName;
    }

    if (typeof req.body.department === "string") {
      updates.department = req.body.department.trim() || null;
    }

    if (typeof req.body.is_active === "boolean") {
      updates.is_active = req.body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid changes provided." });
      return;
    }

    const { data: staff, error: lookupError } =
      await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", staffId)
        .eq("role", "maintenance")
        .maybeSingle();

    if (lookupError || !staff) {
      res.status(404).json({ error: "Maintenance staff member not found." });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", staffId)
      .select("id, full_name, department, is_active")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      message: "Staff details updated.",
      staff: data,
    });
  } catch {
    res.status(500).json({ error: "Unable to update staff member." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
