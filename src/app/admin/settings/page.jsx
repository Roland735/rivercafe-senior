// app/(admin)/settings/page.jsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  FiEdit,
  FiTrash2,
  FiPlus,
  FiSave,
  FiX,
  FiToggleLeft,
  FiToggleRight,
} from "react-icons/fi";

/**
 * ValueEditor
 * - JSON mode when value is an object OR when rawText looks like JSON (starts with { or [)
 * - Keeps local text so editing doesn't flip the component type
 * - Calls onChange(parsed) only when JSON is valid for JSON mode.
 */
function ValueEditor({ value, onChange, onRawChange, placeholder }) {
  // decide json mode: object OR string that looks like JSON
  const isJsonMode = useMemo(() => {
    if (typeof value === "object" && value !== null) return true;
    if (typeof value === "string") {
      const t = value.trim();
      return t.startsWith("{") || t.startsWith("[");
    }
    return false;
  }, [value]);

  const initialText =
    typeof value === "object" && value !== null
      ? JSON.stringify(value, null, 2)
      : value === undefined || value === null
      ? ""
      : String(value);

  const [text, setText] = useState(initialText);
  const [jsonError, setJsonError] = useState(null);

  useEffect(() => {
    const next =
      typeof value === "object" && value !== null
        ? JSON.stringify(value, null, 2)
        : value === undefined || value === null
        ? ""
        : String(value);
    setText(next);
    setJsonError(null);
  }, [value, isJsonMode]);

  function handleTextChange(e) {
    const t = e.target.value;
    setText(t);
    if (onRawChange) onRawChange(t);

    if (isJsonMode) {
      try {
        const parsed = JSON.parse(t);
        setJsonError(null);
        if (onChange) onChange(parsed);
      } catch (err) {
        setJsonError(err?.message || "Invalid JSON");
      }
    } else {
      if (onChange) onChange(t);
    }
  }

  if (isJsonMode) {
    return (
      <div>
        <textarea
          className="w-full p-3 bg-slate-900 rounded text-slate-100 font-mono min-h-[140px]"
          value={text}
          onChange={handleTextChange}
          placeholder={placeholder || "Edit JSON value"}
        />
        {jsonError ? (
          <div className="text-xs text-amber-400 mt-1">JSON: {jsonError}</div>
        ) : (
          <div className="text-xs text-slate-400 mt-1">
            Valid JSON required to parse object
          </div>
        )}
      </div>
    );
  }

  return (
    <input
      className="w-full p-2 bg-slate-900 rounded text-slate-100"
      value={text}
      onChange={handleTextChange}
      placeholder={placeholder || ""}
    />
  );
}

/* Simple Modal wrapper */
function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-xl w-full max-w-2xl p-5 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-slate-700 text-slate-300"
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>

        <div className="space-y-4">{children}</div>

        {footer && <div className="mt-4">{footer}</div>}
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState([]);
  const [windows, setWindows] = useState([]);
  const [specialWindows, setSpecialWindows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [windowMode, setWindowMode] = useState("ordinary");
  const [specialOrdersEnabled, setSpecialOrdersEnabled] = useState(true);
  const [specialOrdersBannerText, setSpecialOrdersBannerText] = useState(
    "Try SPECIAL ORDERS today — collect during LUNCHTIME ONLY."
  );
  const [specialOrdersBannerNote, setSpecialOrdersBannerNote] = useState(
    "Special orders can only be collected during lunchtime."
  );
  const [savingSpecialOrders, setSavingSpecialOrders] = useState(false);

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editKeyOriginal, setEditKeyOriginal] = useState(null);
  const [editKeyInput, setEditKeyInput] = useState("");
  const [editValueParsed, setEditValueParsed] = useState(null);
  const [editRawValue, setEditRawValue] = useState("");
  const [editDescription, setEditDescription] = useState("");

  // Window modal state
  const [isWindowOpen, setIsWindowOpen] = useState(false);
  const [editingWindowId, setEditingWindowId] = useState(null);
  const [windowEditForm, setWindowEditForm] = useState({
    name: "",
    daysOfWeek: [],
    startTime: "07:30",
    endTime: "10:00",
    active: true,
    timezone: "Africa/Harare",
  });

  // Special ordering window modal state
  const [isSpecialWindowOpen, setIsSpecialWindowOpen] = useState(false);
  const [editingSpecialWindowId, setEditingSpecialWindowId] = useState(null);
  const [specialWindowEditForm, setSpecialWindowEditForm] = useState({
    category: "",
    name: "",
    daysOfWeek: [],
    startTime: "07:30",
    endTime: "10:00",
    active: true,
    timezone: "Africa/Harare",
  });

  // create setting fields
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  // load settings & windows
  async function loadAll() {
    setLoading(true);
    try {
      const [sRes, wRes, swRes] = await Promise.all([
        fetch("/api/admin/settings", { cache: "no-store" }),
        fetch("/api/admin/ordering-windows", { cache: "no-store" }),
        fetch("/api/admin/special-ordering-windows", { cache: "no-store" }),
      ]);
      const sBody = await sRes.json();
      const wBody = await wRes.json();
      const swBody = await swRes.json();
      if (!sBody.ok) throw new Error(sBody.error || "Failed to load settings");
      if (!wBody.ok) throw new Error(wBody.error || "Failed to load windows");
      if (!swBody.ok)
        throw new Error(swBody.error || "Failed to load special windows");
      const nextSettings = sBody.settings || [];
      setSettings(nextSettings);
      setWindows(wBody.windows || []);
      setSpecialWindows(swBody.windows || []);

      const getSetting = (key) =>
        nextSettings.find((s) => s.key === key)?.value;

      const enabledRaw = getSetting("specialOrders.enabled");
      const enabled =
        typeof enabledRaw === "boolean"
          ? enabledRaw
          : typeof enabledRaw === "string"
          ? enabledRaw.trim().toLowerCase() !== "false"
          : enabledRaw === null || enabledRaw === undefined
          ? true
          : Boolean(enabledRaw);
      setSpecialOrdersEnabled(enabled);

      const bannerTextRaw = getSetting("specialOrders.bannerText");
      const bannerNoteRaw = getSetting("specialOrders.bannerNote");
      if (bannerTextRaw !== undefined && bannerTextRaw !== null) {
        setSpecialOrdersBannerText(String(bannerTextRaw));
      }
      if (bannerNoteRaw !== undefined && bannerNoteRaw !== null) {
        setSpecialOrdersBannerNote(String(bannerNoteRaw));
      }
    } catch (err) {
      alert(err.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function parseSmart(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      if (raw !== null && raw !== "" && !isNaN(Number(raw))) return Number(raw);
      return raw;
    }
  }

  // -----------------------
  // Settings create/update/delete flows
  // -----------------------
  async function createSetting() {
    if (!newKey.trim()) return alert("Key required");
    try {
      const payload = {
        settings: [
          { key: newKey.trim(), value: parseSmart(newValue), description: "" },
        ],
      };
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Create failed");
      setNewKey("");
      setNewValue("");
      await loadAll();
    } catch (err) {
      alert(err.message || "Create failed");
    }
  }

  async function deleteSetting(key) {
    if (!confirm(`Delete setting ${key}?`)) return;
    try {
      const res = await fetch(
        `/api/admin/settings/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        }
      );
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Delete failed");
      if (editKeyOriginal === key) closeSettingsModal();
      await loadAll();
    } catch (err) {
      alert(err.message || "Delete failed");
    }
  }

  // open settings modal populated
  function openSettingsModalFor(s) {
    // try to detect JSON string that contains object
    let parsed = s.value;
    if (typeof s.value === "string") {
      const t = s.value.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          parsed = JSON.parse(t);
        } catch (e) {
          // keep as string if not valid
          parsed = s.value;
        }
      }
    }
    setEditKeyOriginal(s.key);
    setEditKeyInput(s.key);
    setEditValueParsed(parsed);
    setEditRawValue(
      typeof parsed === "object"
        ? JSON.stringify(parsed, null, 2)
        : parsed === undefined || parsed === null
        ? ""
        : String(parsed)
    );
    setEditDescription(s.description || "");
    setIsSettingsOpen(true);
    // focus handled by Modal close/open naturally
  }

  function closeSettingsModal() {
    setIsSettingsOpen(false);
    setEditKeyOriginal(null);
    setEditKeyInput("");
    setEditValueParsed(null);
    setEditRawValue("");
    setEditDescription("");
  }

  const hasSettingsChanged = useMemo(() => {
    if (!editKeyOriginal) return false;
    const original = settings.find((x) => x.key === editKeyOriginal);
    if (!original) return true;
    try {
      return (
        JSON.stringify(original.value) !== JSON.stringify(editValueParsed) ||
        original.key !== editKeyInput ||
        (original.description || "") !== (editDescription || "")
      );
    } catch (e) {
      return String(original.value) !== String(editValueParsed);
    }
  }, [
    editKeyOriginal,
    editKeyInput,
    editValueParsed,
    editDescription,
    settings,
  ]);

  async function saveSettingsModal() {
    if (!editKeyOriginal) return;
    if (!editKeyInput.trim()) return alert("Key cannot be empty");

    const newKeyTrim = editKeyInput.trim();

    try {
      if (newKeyTrim === editKeyOriginal) {
        const res = await fetch(
          `/api/admin/settings/${encodeURIComponent(editKeyOriginal)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              value: editValueParsed,
              description: editDescription,
            }),
          }
        );
        const body = await res.json();
        if (!body.ok) throw new Error(body.error || "Update failed");
        await loadAll();
        closeSettingsModal();
        return;
      }

      // rename: create then delete old
      const createPayload = {
        settings: [
          {
            key: newKeyTrim,
            value: editValueParsed,
            description: editDescription || "",
          },
        ],
      };
      const createRes = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
      });
      const createBody = await createRes.json();
      if (!createBody.ok)
        throw new Error(createBody.error || "Create (rename) failed");

      const delRes = await fetch(
        `/api/admin/settings/${encodeURIComponent(editKeyOriginal)}`,
        { method: "DELETE" }
      );
      const delBody = await delRes.json();
      if (!delBody.ok)
        console.warn("Old key deletion failed after rename:", delBody);

      await loadAll();
      closeSettingsModal();
    } catch (err) {
      alert(err.message || "Save failed");
    }
  }

  // -----------------------
  // Ordering window flows (open modal, edit, delete)
  // -----------------------
  async function updateWindow(id, patch) {
    try {
      const res = await fetch(`/api/admin/ordering-windows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Update failed");
      await loadAll();
    } catch (err) {
      alert(err.message || "Update failed");
    }
  }

  function openWindowModal(w) {
    setEditingWindowId(w._id);
    setWindowEditForm({
      name: w.name || "",
      daysOfWeek: Array.isArray(w.daysOfWeek) ? w.daysOfWeek.slice() : [],
      startTime: w.startTime || "07:30",
      endTime: w.endTime || "10:00",
      active: typeof w.active === "boolean" ? w.active : true,
      timezone: w.timezone || "Africa/Harare",
      allowedProductIds: w.allowedProductIds || [],
      priority: w.priority || 0,
      description: w.description || "",
    });
    setIsWindowOpen(true);
  }

  function closeWindowModal() {
    setIsWindowOpen(false);
    setEditingWindowId(null);
    setWindowEditForm({
      name: "",
      daysOfWeek: [],
      startTime: "07:30",
      endTime: "10:00",
      active: true,
      timezone: "Africa/Harare",
    });
  }

  function toggleDay(form, day) {
    const s = new Set(form.daysOfWeek || []);
    if (s.has(day)) s.delete(day);
    else s.add(day);
    return { ...form, daysOfWeek: Array.from(s).sort() };
  }

  async function saveWindowModal() {
    if (!editingWindowId) return;
    try {
      const res = await fetch(
        `/api/admin/ordering-windows/${editingWindowId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(windowEditForm),
        }
      );
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Update failed");
      await loadAll();
      closeWindowModal();
    } catch (err) {
      alert(err.message || "Save failed");
    }
  }

  async function deleteWindow(id) {
    if (!confirm("Delete ordering window?")) return;
    try {
      const res = await fetch(`/api/admin/ordering-windows/${id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Delete failed");
      await loadAll();
      if (editingWindowId === id) closeWindowModal();
    } catch (err) {
      alert(err.message || "Delete failed");
    }
  }

  async function createWindow() {
    if (!windowEditForm.name.trim()) return alert("Window name required");
    try {
      const res = await fetch("/api/admin/ordering-windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(windowEditForm),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Create failed");
      await loadAll();
      closeWindowModal();
    } catch (err) {
      alert(err.message || "Create failed");
    }
  }

  async function updateSpecialWindow(id, patch) {
    try {
      const res = await fetch(`/api/admin/special-ordering-windows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Update failed");
      await loadAll();
    } catch (err) {
      alert(err.message || "Update failed");
    }
  }

  function openSpecialWindowModal(w) {
    setEditingSpecialWindowId(w._id);
    setSpecialWindowEditForm({
      category: w.category || "",
      name: w.name || "",
      daysOfWeek: Array.isArray(w.daysOfWeek) ? w.daysOfWeek.slice() : [],
      startTime: w.startTime || "07:30",
      endTime: w.endTime || "10:00",
      active: typeof w.active === "boolean" ? w.active : true,
      timezone: w.timezone || "Africa/Harare",
      priority: w.priority || 0,
      description: w.description || "",
    });
    setIsSpecialWindowOpen(true);
  }

  function closeSpecialWindowModal() {
    setIsSpecialWindowOpen(false);
    setEditingSpecialWindowId(null);
    setSpecialWindowEditForm({
      category: "",
      name: "",
      daysOfWeek: [],
      startTime: "07:30",
      endTime: "10:00",
      active: true,
      timezone: "Africa/Harare",
    });
  }

  async function saveSpecialWindowModal() {
    if (!editingSpecialWindowId) return;
    try {
      const res = await fetch(
        `/api/admin/special-ordering-windows/${editingSpecialWindowId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(specialWindowEditForm),
        }
      );
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Update failed");
      await loadAll();
      closeSpecialWindowModal();
    } catch (err) {
      alert(err.message || "Save failed");
    }
  }

  async function deleteSpecialWindow(id) {
    if (!confirm("Delete special ordering window?")) return;
    try {
      const res = await fetch(`/api/admin/special-ordering-windows/${id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Delete failed");
      await loadAll();
      if (editingSpecialWindowId === id) closeSpecialWindowModal();
    } catch (err) {
      alert(err.message || "Delete failed");
    }
  }

  async function createSpecialWindow() {
    if (!specialWindowEditForm.category.trim())
      return alert("Category required");
    if (!specialWindowEditForm.name.trim())
      return alert("Window name required");
    try {
      const res = await fetch("/api/admin/special-ordering-windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(specialWindowEditForm),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Create failed");
      await loadAll();
      closeSpecialWindowModal();
    } catch (err) {
      alert(err.message || "Create failed");
    }
  }

  async function saveSpecialOrdersSettings() {
    setSavingSpecialOrders(true);
    try {
      const payload = {
        settings: [
          {
            key: "specialOrders.enabled",
            value: Boolean(specialOrdersEnabled),
            description: "Enable/disable special orders for students",
          },
          {
            key: "specialOrders.bannerText",
            value: String(specialOrdersBannerText || ""),
            description: "Student-facing special orders banner text",
          },
          {
            key: "specialOrders.bannerNote",
            value: String(specialOrdersBannerNote || ""),
            description: "Student-facing special orders banner note",
          },
        ],
      };
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) throw new Error(body.error || "Save failed");
      await loadAll();
    } catch (err) {
      alert(err.message || "Save failed");
    } finally {
      setSavingSpecialOrders(false);
    }
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
          <p className="text-sm text-slate-300">
            Global configuration, external code policy, tax/discounts, and
            ordering windows.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Create setting + quick actions */}
        <div className="col-span-1 space-y-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-100 font-semibold mb-2">
              Create setting
            </div>
            <div className="mb-2">
              <input
                placeholder="key"
                className="w-full p-2 bg-slate-900 rounded text-slate-100"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <div className="mb-2">
              <input
                placeholder="value (JSON or text)"
                className="w-full p-2 bg-slate-900 rounded text-slate-100"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={createSetting}
                className="inline-flex items-center gap-2 px-3 py-2 rounded bg-cyan-500 text-white"
              >
                <FiPlus /> Create
              </button>
              <button
                onClick={loadAll}
                className="inline-flex items-center gap-2 px-3 py-2 rounded bg-slate-700 text-slate-200"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-100 font-semibold mb-2">Quick info</div>
            <div className="text-sm text-slate-300">
              Click Edit to open a full editor. JSON values are edited in a
              textarea with validation. No browser prompts.
            </div>
          </div>
        </div>

        {/* Middle: Settings list */}
        <div className="col-span-2 bg-slate-800 border border-slate-700 rounded-xl p-4">
          <h2 className="font-semibold text-slate-100 mb-3">
            General settings
          </h2>

          <div className="space-y-3">
            {settings.map((s) => (
              <div
                key={s.key}
                className="flex items-start justify-between gap-3 bg-slate-700 p-3 rounded"
              >
                <div className="flex-1">
                  <div className="text-slate-100 font-medium">{s.key}</div>
                  <div className="text-sm text-slate-300">
                    {s.description || "—"}
                  </div>
                </div>

                <div className="w-64">
                  <div className="text-sm text-slate-200 mb-1 truncate">
                    {typeof s.value === "object"
                      ? JSON.stringify(s.value)
                      : String(s.value)}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openSettingsModalFor(s)}
                      className="p-2 rounded hover:bg-slate-600"
                    >
                      <FiEdit />
                    </button>
                    <button
                      onClick={() => deleteSetting(s.key)}
                      className="p-2 rounded hover:bg-red-700"
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {settings.length === 0 && (
              <div className="text-sm text-slate-400">No settings found.</div>
            )}
          </div>
        </div>

        {/* Right column: Ordering windows */}
        <div className="col-span-1 bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="font-semibold text-slate-100">Ordering windows</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWindowMode("ordinary")}
                className={`px-2 py-1 rounded text-sm ${
                  windowMode === "ordinary"
                    ? "bg-red-600 text-white"
                    : "bg-slate-700 text-slate-200"
                }`}
              >
                Ordinary
              </button>
              <button
                onClick={() => setWindowMode("special")}
                className={`px-2 py-1 rounded text-sm ${
                  windowMode === "special"
                    ? "bg-red-600 text-white"
                    : "bg-slate-700 text-slate-200"
                }`}
              >
                Special
              </button>
            </div>
          </div>

          {windowMode === "special" ? (
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3 mb-3">
              <div className="text-sm font-semibold text-slate-100 mb-2">
                Special orders settings
              </div>

              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-300">
                  Enabled for students
                </div>
                <button
                  onClick={() => setSpecialOrdersEnabled((v) => !v)}
                  className={`px-3 py-1 rounded text-sm ${
                    specialOrdersEnabled
                      ? "bg-emerald-400 text-black"
                      : "bg-slate-700 text-slate-200"
                  }`}
                >
                  {specialOrdersEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              <div className="mb-2">
                <label className="text-xs text-slate-400">Banner text</label>
                <input
                  value={specialOrdersBannerText}
                  onChange={(e) => setSpecialOrdersBannerText(e.target.value)}
                  className="w-full p-2 bg-slate-900 rounded text-slate-100"
                  placeholder="e.g. Try SPECIAL ORDERS today — collect during LUNCHTIME ONLY."
                />
              </div>

              <div className="mb-2">
                <label className="text-xs text-slate-400">Banner note</label>
                <input
                  value={specialOrdersBannerNote}
                  onChange={(e) => setSpecialOrdersBannerNote(e.target.value)}
                  className="w-full p-2 bg-slate-900 rounded text-slate-100"
                  placeholder="e.g. Special orders can only be collected during lunchtime."
                />
              </div>

              <button
                onClick={saveSpecialOrdersSettings}
                disabled={savingSpecialOrders}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-amber-500 text-black disabled:opacity-60"
              >
                <FiSave /> {savingSpecialOrders ? "Saving..." : "Save"}
              </button>
            </div>
          ) : null}

          <div className="space-y-3 mb-3">
            {windowMode === "ordinary" ? (
              <>
                {windows.map((w) => (
                  <div
                    key={w._id}
                    className="bg-slate-700 p-3 rounded flex items-center justify-between"
                  >
                    <div>
                      <div className="text-slate-100 font-medium">
                        {w.name}{" "}
                        {w.active ? (
                          <span className="text-emerald-300 text-sm ml-2">
                            Active
                          </span>
                        ) : (
                          <span className="text-slate-400 text-sm ml-2">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-slate-300">
                        {(w.daysOfWeek || []).join(", ")} • {w.startTime} -{" "}
                        {w.endTime} •{" "}
                        <span className="text-xs text-slate-400">
                          tz:{w.timezone}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        title="Toggle active"
                        onClick={() => {
                          updateWindow(w._id, { active: !w.active });
                        }}
                        className="p-2 rounded hover:bg-slate-600"
                      >
                        {w.active ? <FiToggleRight /> : <FiToggleLeft />}
                      </button>

                      <button
                        title="Edit window"
                        onClick={() => openWindowModal(w)}
                        className="p-2 rounded hover:bg-slate-600"
                      >
                        <FiEdit />
                      </button>

                      <button
                        title="Delete window"
                        onClick={() => deleteWindow(w._id)}
                        className="p-2 rounded hover:bg-red-700"
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </div>
                ))}
                {windows.length === 0 && (
                  <div className="text-sm text-slate-400">
                    No ordering windows configured.
                  </div>
                )}
              </>
            ) : (
              <>
                {specialWindows.map((w) => (
                  <div
                    key={w._id}
                    className="bg-slate-700 p-3 rounded flex items-center justify-between"
                  >
                    <div>
                      <div className="text-slate-100 font-medium">
                        {w.name}{" "}
                        <span className="text-slate-300 text-sm ml-2">
                          ({w.category})
                        </span>
                        {w.active ? (
                          <span className="text-emerald-300 text-sm ml-2">
                            Active
                          </span>
                        ) : (
                          <span className="text-slate-400 text-sm ml-2">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-slate-300">
                        {(w.daysOfWeek || []).join(", ")} • {w.startTime} -{" "}
                        {w.endTime} •{" "}
                        <span className="text-xs text-slate-400">
                          tz:{w.timezone}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        title="Toggle active"
                        onClick={() => {
                          updateSpecialWindow(w._id, { active: !w.active });
                        }}
                        className="p-2 rounded hover:bg-slate-600"
                      >
                        {w.active ? <FiToggleRight /> : <FiToggleLeft />}
                      </button>

                      <button
                        title="Edit window"
                        onClick={() => openSpecialWindowModal(w)}
                        className="p-2 rounded hover:bg-slate-600"
                      >
                        <FiEdit />
                      </button>

                      <button
                        title="Delete window"
                        onClick={() => deleteSpecialWindow(w._id)}
                        className="p-2 rounded hover:bg-red-700"
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </div>
                ))}
                {specialWindows.length === 0 && (
                  <div className="text-sm text-slate-400">
                    No special ordering windows configured.
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-slate-700 pt-3 mt-4">
            {windowMode === "ordinary" ? (
              <>
                <div className="text-sm text-slate-300 mb-2">
                  Create ordering window
                </div>

                <input
                  placeholder="Name"
                  value={windowEditForm.name}
                  onChange={(e) =>
                    setWindowEditForm({
                      ...windowEditForm,
                      name: e.target.value,
                    })
                  }
                  className="w-full p-2 bg-slate-900 rounded text-slate-100 mb-2"
                />

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-sm text-slate-300">Start time</label>
                    <input
                      type="time"
                      value={windowEditForm.startTime}
                      onChange={(e) =>
                        setWindowEditForm({
                          ...windowEditForm,
                          startTime: e.target.value,
                        })
                      }
                      className="w-full p-2 bg-slate-900 rounded text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-slate-300">End time</label>
                    <input
                      type="time"
                      value={windowEditForm.endTime}
                      onChange={(e) =>
                        setWindowEditForm({
                          ...windowEditForm,
                          endTime: e.target.value,
                        })
                      }
                      className="w-full p-2 bg-slate-900 rounded text-slate-100"
                    />
                  </div>
                </div>

                <div className="mb-2">
                  <label className="text-sm text-slate-300">Days</label>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <button
                        key={d}
                        onClick={() =>
                          setWindowEditForm(toggleDay(windowEditForm, d))
                        }
                        className={`px-2 py-1 rounded ${
                          windowEditForm.daysOfWeek.includes(d)
                            ? "bg-amber-500 text-black"
                            : "bg-slate-900 text-slate-300"
                        }`}
                      >
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      if (!windowEditForm.name.trim())
                        return alert("Name required");
                      createWindow();
                    }}
                    className="bg-cyan-500 hover:bg-cyan-600 px-3 py-2 rounded text-white"
                  >
                    <FiPlus /> Create window
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-slate-300 mb-2">
                  Create special ordering window
                </div>

                <input
                  placeholder="Category"
                  value={specialWindowEditForm.category}
                  onChange={(e) =>
                    setSpecialWindowEditForm({
                      ...specialWindowEditForm,
                      category: e.target.value,
                    })
                  }
                  className="w-full p-2 bg-slate-900 rounded text-slate-100 mb-2"
                />

                <input
                  placeholder="Name"
                  value={specialWindowEditForm.name}
                  onChange={(e) =>
                    setSpecialWindowEditForm({
                      ...specialWindowEditForm,
                      name: e.target.value,
                    })
                  }
                  className="w-full p-2 bg-slate-900 rounded text-slate-100 mb-2"
                />

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-sm text-slate-300">Start time</label>
                    <input
                      type="time"
                      value={specialWindowEditForm.startTime}
                      onChange={(e) =>
                        setSpecialWindowEditForm({
                          ...specialWindowEditForm,
                          startTime: e.target.value,
                        })
                      }
                      className="w-full p-2 bg-slate-900 rounded text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-slate-300">End time</label>
                    <input
                      type="time"
                      value={specialWindowEditForm.endTime}
                      onChange={(e) =>
                        setSpecialWindowEditForm({
                          ...specialWindowEditForm,
                          endTime: e.target.value,
                        })
                      }
                      className="w-full p-2 bg-slate-900 rounded text-slate-100"
                    />
                  </div>
                </div>

                <div className="mb-2">
                  <label className="text-sm text-slate-300">Days</label>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <button
                        key={d}
                        onClick={() =>
                          setSpecialWindowEditForm(
                            toggleDay(specialWindowEditForm, d)
                          )
                        }
                        className={`px-2 py-1 rounded ${
                          specialWindowEditForm.daysOfWeek.includes(d)
                            ? "bg-amber-500 text-black"
                            : "bg-slate-900 text-slate-300"
                        }`}
                      >
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      if (!specialWindowEditForm.category.trim())
                        return alert("Category required");
                      if (!specialWindowEditForm.name.trim())
                        return alert("Name required");
                      createSpecialWindow();
                    }}
                    className="bg-cyan-500 hover:bg-cyan-600 px-3 py-2 rounded text-white"
                  >
                    <FiPlus /> Create window
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <Modal
        open={isSettingsOpen}
        onClose={closeSettingsModal}
        title={
          editKeyOriginal ? `Edit setting — ${editKeyOriginal}` : "Edit setting"
        }
        footer={
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => deleteSetting(editKeyOriginal)}
              className="px-3 py-2 rounded bg-red-700 text-white"
            >
              <FiTrash2 /> Delete
            </button>
            <button
              onClick={closeSettingsModal}
              className="px-3 py-2 rounded bg-slate-700 text-slate-200"
            >
              Cancel
            </button>
            <button
              disabled={!hasSettingsChanged}
              onClick={saveSettingsModal}
              className={`px-3 py-2 rounded ${
                hasSettingsChanged
                  ? "bg-amber-500 text-black"
                  : "bg-slate-700 text-slate-400 cursor-not-allowed"
              }`}
            >
              <FiSave /> Save
            </button>
          </div>
        }
      >
        <div>
          <label className="text-xs text-slate-400">Key</label>
          <input
            id="edit-key-input"
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={editKeyInput}
            onChange={(e) => setEditKeyInput(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs text-slate-400">Value</label>
          <ValueEditor
            value={editValueParsed}
            onChange={(v) => setEditValueParsed(v)}
            onRawChange={(r) => setEditRawValue(r)}
          />
        </div>

        <div>
          <label className="text-xs text-slate-400">
            Description (optional)
          </label>
          <input
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
        </div>
      </Modal>

      {/* Window Modal */}
      <Modal
        open={isWindowOpen}
        onClose={closeWindowModal}
        title={editingWindowId ? "Edit ordering window" : "New ordering window"}
        footer={
          <div className="flex gap-2 justify-end">
            {editingWindowId && (
              <button
                onClick={() => deleteWindow(editingWindowId)}
                className="px-3 py-2 rounded bg-red-700 text-white"
              >
                <FiTrash2 /> Delete
              </button>
            )}
            <button
              onClick={closeWindowModal}
              className="px-3 py-2 rounded bg-slate-700 text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={editingWindowId ? saveWindowModal : createWindow}
              className="px-3 py-2 rounded bg-amber-500 text-black"
            >
              <FiSave /> {editingWindowId ? "Save" : "Create"}
            </button>
          </div>
        }
      >
        <div>
          <label className="text-xs text-slate-400">Name</label>
          <input
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={windowEditForm.name}
            onChange={(e) =>
              setWindowEditForm({ ...windowEditForm, name: e.target.value })
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400">Start time</label>
            <input
              type="time"
              className="w-full p-2 bg-slate-900 rounded text-slate-100"
              value={windowEditForm.startTime}
              onChange={(e) =>
                setWindowEditForm({
                  ...windowEditForm,
                  startTime: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">End time</label>
            <input
              type="time"
              className="w-full p-2 bg-slate-900 rounded text-slate-100"
              value={windowEditForm.endTime}
              onChange={(e) =>
                setWindowEditForm({
                  ...windowEditForm,
                  endTime: e.target.value,
                })
              }
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">Days</label>
          <div className="flex gap-1 mt-2 flex-wrap">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button
                key={d}
                onClick={() => setWindowEditForm(toggleDay(windowEditForm, d))}
                className={`px-2 py-1 rounded ${
                  windowEditForm.daysOfWeek.includes(d)
                    ? "bg-amber-500 text-black"
                    : "bg-slate-900 text-slate-300"
                }`}
              >
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 items-center">
          <div>
            <label className="text-xs text-slate-400">Timezone</label>
            <input
              className="w-full p-2 bg-slate-900 rounded text-slate-100"
              value={windowEditForm.timezone}
              onChange={(e) =>
                setWindowEditForm({
                  ...windowEditForm,
                  timezone: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Active</label>
            <div>
              <button
                onClick={() =>
                  setWindowEditForm({
                    ...windowEditForm,
                    active: !windowEditForm.active,
                  })
                }
                className={`px-3 py-1 rounded ${
                  windowEditForm.active
                    ? "bg-emerald-400 text-black"
                    : "bg-slate-900 text-slate-300"
                }`}
              >
                {windowEditForm.active ? "Active" : "Inactive"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">
            Description (optional)
          </label>
          <input
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={windowEditForm.description || ""}
            onChange={(e) =>
              setWindowEditForm({
                ...windowEditForm,
                description: e.target.value,
              })
            }
          />
        </div>
      </Modal>

      {/* Special Window Modal */}
      <Modal
        open={isSpecialWindowOpen}
        onClose={closeSpecialWindowModal}
        title={
          editingSpecialWindowId
            ? "Edit special ordering window"
            : "New special ordering window"
        }
        footer={
          <div className="flex gap-2 justify-end">
            {editingSpecialWindowId && (
              <button
                onClick={() => deleteSpecialWindow(editingSpecialWindowId)}
                className="px-3 py-2 rounded bg-red-700 text-white"
              >
                <FiTrash2 /> Delete
              </button>
            )}
            <button
              onClick={closeSpecialWindowModal}
              className="px-3 py-2 rounded bg-slate-700 text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={
                editingSpecialWindowId
                  ? saveSpecialWindowModal
                  : createSpecialWindow
              }
              className="px-3 py-2 rounded bg-amber-500 text-black"
            >
              <FiSave /> {editingSpecialWindowId ? "Save" : "Create"}
            </button>
          </div>
        }
      >
        <div>
          <label className="text-xs text-slate-400">Category</label>
          <input
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={specialWindowEditForm.category}
            onChange={(e) =>
              setSpecialWindowEditForm({
                ...specialWindowEditForm,
                category: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="text-xs text-slate-400">Name</label>
          <input
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={specialWindowEditForm.name}
            onChange={(e) =>
              setSpecialWindowEditForm({
                ...specialWindowEditForm,
                name: e.target.value,
              })
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400">Start time</label>
            <input
              type="time"
              className="w-full p-2 bg-slate-900 rounded text-slate-100"
              value={specialWindowEditForm.startTime}
              onChange={(e) =>
                setSpecialWindowEditForm({
                  ...specialWindowEditForm,
                  startTime: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">End time</label>
            <input
              type="time"
              className="w-full p-2 bg-slate-900 rounded text-slate-100"
              value={specialWindowEditForm.endTime}
              onChange={(e) =>
                setSpecialWindowEditForm({
                  ...specialWindowEditForm,
                  endTime: e.target.value,
                })
              }
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">Days</label>
          <div className="flex gap-1 mt-2 flex-wrap">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button
                key={d}
                onClick={() =>
                  setSpecialWindowEditForm(toggleDay(specialWindowEditForm, d))
                }
                className={`px-2 py-1 rounded ${
                  specialWindowEditForm.daysOfWeek.includes(d)
                    ? "bg-amber-500 text-black"
                    : "bg-slate-900 text-slate-300"
                }`}
              >
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 items-center">
          <div>
            <label className="text-xs text-slate-400">Timezone</label>
            <input
              className="w-full p-2 bg-slate-900 rounded text-slate-100"
              value={specialWindowEditForm.timezone}
              onChange={(e) =>
                setSpecialWindowEditForm({
                  ...specialWindowEditForm,
                  timezone: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Active</label>
            <div>
              <button
                onClick={() =>
                  setSpecialWindowEditForm({
                    ...specialWindowEditForm,
                    active: !specialWindowEditForm.active,
                  })
                }
                className={`px-3 py-1 rounded ${
                  specialWindowEditForm.active
                    ? "bg-emerald-400 text-black"
                    : "bg-slate-900 text-slate-300"
                }`}
              >
                {specialWindowEditForm.active ? "Active" : "Inactive"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">
            Description (optional)
          </label>
          <input
            className="w-full p-2 bg-slate-900 rounded text-slate-100"
            value={specialWindowEditForm.description || ""}
            onChange={(e) =>
              setSpecialWindowEditForm({
                ...specialWindowEditForm,
                description: e.target.value,
              })
            }
          />
        </div>
      </Modal>
    </div>
  );
}
