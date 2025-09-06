import React, { useEffect, useMemo, useState } from "react";

/**
 * 📌 Simplified demo for real users (future bookings only)
 * - ผู้ใช้ทำได้แค่:
 *   1) ดูตารางการจอง (เฉพาะอนาคต)
 *   2) เพิ่มการจองของตัวเอง
 * - ปิดฟังก์ชัน: ลบการจอง, จัดการรายการเครื่อง, self-tests
 */

// ========================= Config =========================
const LS_API_URL_KEY = "gym_booking_api_url_v1";
const PLACEHOLDER_API =
  "https://script.google.com/macros/s/AKfycbwGmHOLpwTwhU3uG3iKy2ghLPl2MT_BhatSN0LX84KgHy2az6C8AjYr3cWcHfb6F7-Kcw/exec"; // หรือจะวาง /exec URL ที่นี่

function useApiUrl() {
  const [apiUrl, setApiUrl] = useState(
    () => localStorage.getItem(LS_API_URL_KEY) || PLACEHOLDER_API
  );
  useEffect(() => localStorage.setItem(LS_API_URL_KEY, apiUrl), [apiUrl]);
  return [apiUrl, setApiUrl];
}

function isLikelyAppsScriptUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "script.google.com" &&
      /\/macros\/s\//.test(u.pathname) &&
      u.pathname.endsWith("/exec")
    );
  } catch {
    return false;
  }
}

async function fetchWithTimeout(input, init = {}, ms = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(init.headers || {}) },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function readJsonOrThrow(res) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return { json, contentType };
  } catch (e) {
    const snippet = text.slice(0, 200).replace(/\n/g, " ");
    throw new Error(
      `Non-JSON response. HTTP ${res.status}. content-type: ${contentType}. Body: ${snippet}`
    );
  }
}

// ========================= Data helpers =========================
const DEFAULT_MACHINES = [
  { id: "underwater-treadmill", label: "ลู่วิ่งในน้ำ" },
];

const SLOT_START = 6; // 06:00
const SLOT_END = 22; // 22:00

function hoursToSlots(start, end) {
  const slots = [];
  for (let h = start; h < end; h++) {
    const hh = String(h).padStart(2, "0");
    const hh2 = String(h + 1).padStart(2, "0");
    slots.push({ id: `${hh}:00-${hh2}:00`, label: `${hh}:00-${hh2}:00` });
  }
  return slots;
}
const SLOTS = hoursToSlots(SLOT_START, SLOT_END);

function getNextDays(n = 7) {
  const days = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyDate(d) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "full" }).format(d);
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// --- normalize dates coming from Google Sheets / Apps Script ---
function toISODateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function normalizeDate(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; // already YYYY-MM-DD
    const dt = new Date(value);
    if (!isNaN(dt)) return toISODateString(dt);
  }
  if (typeof value === "number") {
    const dt = new Date(value); // epoch ms (Apps Script อาจส่งมาแบบนี้)
    if (!isNaN(dt)) return toISODateString(dt);
  }
  try {
    const dt = new Date(value);
    if (!isNaN(dt)) return toISODateString(dt);
  } catch {}
  return String(value);
}

// ---- mapping Sheet <-> UI ----
function rowToBooking(row) {
  return {
    id: row.booking_id,
    date: normalizeDate(row.date), // 🔧 สำคัญ: normalize ให้เป็น YYYY-MM-DD
    slotId: row.slot,
    machineId: row.machine_id,
    firstName: row.first_name,
    lastName: row.last_name,
    memberId: row.member_id,
    age: Number(row.age || 0),
    createdAt: row.created_at,
  };
}
function bookingToRow(b) {
  return {
    booking_id: b.id,
    date: b.date,
    slot: b.slotId,
    machine_id: b.machineId,
    first_name: b.firstName,
    last_name: b.lastName,
    member_id: b.memberId,
    age: b.age,
    created_at: b.createdAt || new Date().toISOString(),
  };
}

// ---- time helpers: future-only view & past-slot guard ----
function slotStartHour(slotId) {
  const m = /^(\d{2}):\d{2}-/.exec(slotId || "");
  return m ? Number(m[1]) : 0;
}
function bookingStartDate(b) {
  const h = slotStartHour(b.slotId);
  if (!b || !b.date) return new Date(0);
  if (String(b.date).includes("T")) return new Date(b.date); // already ISO
  const hh = String(h).padStart(2, "0");
  return new Date(b.date + "T" + hh + ":00:00");
}
function isFutureBooking(b) {
  return bookingStartDate(b) >= new Date();
}
function isPastSlot(dateStr, slotId) {
  const h = slotStartHour(slotId);
  try {
    const d = new Date(dateStr + "T" + String(h).padStart(2, "0") + ":00:00");
    return d < new Date();
  } catch {
    return false;
  }
}
// Thai date/time range formatter → "9 กันยายน 2568 13.00 น. - 14.00 น."
function formatThaiDateRange(dateStr, slotId) {
  const startH = slotStartHour(slotId);
  const endH = startH + 1;
  const d = new Date(
    dateStr + "T" + String(startH).padStart(2, "0") + ":00:00"
  );
  const datePart = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const hhmm = (h) => String(h).padStart(2, "0") + ".00";
  return `${datePart} ${hhmm(startH)} น. - ${hhmm(endH)} น.`;
}
function formatBookingLine(b) {
  return `${b.firstName} ${b.lastName} • ${b.machineId} • ${formatThaiDateRange(
    b.date,
    b.slotId
  )}`;
}

// ========================= App =========================
export default function App() {
  const [apiUrl, setApiUrl] = useApiUrl();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const days = useMemo(() => getNextDays(7), []);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    memberId: "",
    age: "",
    machineId: DEFAULT_MACHINES[0].id,
    date: dateKey(days[0]),
    slotId: SLOTS[0].id,
  });

  async function loadFromServer() {
    if (!isLikelyAppsScriptUrl(apiUrl)) return;
    setLoading(true);
    setApiError("");
    try {
      const res = await fetchWithTimeout(apiUrl, { method: "GET" }, 15000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { json } = await readJsonOrThrow(res);
      if (json.ok && Array.isArray(json.data)) {
        const mapped = json.data.map(rowToBooking);
        const rows = mapped
          .filter(isFutureBooking)
          .sort((a, b) => bookingStartDate(a) - bookingStartDate(b));
        setBookings(rows);
        if (mapped.length && !rows.length) {
          setApiError(
            "โหลดสำเร็จแต่ไม่มีรายการอนาคตให้แสดง (ตรวจรูปแบบวันที่/เวลาในชีต)"
          );
        }
        setLastFetchedAt(new Date().toLocaleString());
      }
    } catch (err) {
      setApiError("โหลดข้อมูลล้มเหลว: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFromServer();
  }, []);

  function hasConflict(machineId, date, slotId) {
    return bookings.some(
      (b) => b.machineId === machineId && b.date === date && b.slotId === slotId
    );
  }

  async function createOnServer(newBooking) {
    const payload = { action: "create", ...bookingToRow(newBooking) };
    const res = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // หลบ CORS preflight
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { json } = await readJsonOrThrow(res);
    return json;
  }

  async function submitBooking(e) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.memberId || !form.age) {
      alert("กรุณากรอกข้อมูลให้ครบ");
      return;
    }
    if (hasConflict(form.machineId, form.date, form.slotId)) {
      alert("ช่วงเวลานี้ถูกจองแล้ว");
      return;
    }
    if (isPastSlot(form.date, form.slotId)) {
      alert("เลือกช่วงเวลาที่ผ่านไปแล้วไม่ได้");
      return;
    }

    const newBooking = {
      id: uid(),
      ...form,
      age: Number(form.age),
      createdAt: new Date().toISOString(),
    };
    setSaving(true);
    // Optimistic update: โชว์รายการทันที แล้วค่อยซิงก์กับฐานข้อมูลจริง
    setBookings((prev) =>
      [...prev, newBooking].sort(
        (a, b) => bookingStartDate(a) - bookingStartDate(b)
      )
    );
    try {
      const result = await createOnServer(newBooking);
      if (result && result.ok) {
        await loadFromServer();
        setForm((f) => ({ ...f, slotId: SLOTS[0].id }));
      }
    } catch (err) {
      setApiError("บันทึกข้อมูลล้มเหลว: " + err.message);
      await loadFromServer(); // ซิงก์กลับเพื่อแก้กรณี optimistic ผิดพลาด
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-1">ระบบจองใช้เครื่องออกกำลังกาย</h1>
      <ApiConfig
        apiUrl={apiUrl}
        setApiUrl={setApiUrl}
        onTest={loadFromServer}
        status={{ loading, lastFetchedAt, apiError }}
      />

      <form onSubmit={submitBooking} className="grid grid-cols-2 gap-2 mb-6">
        <input
          placeholder="ชื่อ"
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          className="border p-2"
        />
        <input
          placeholder="นามสกุล"
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          className="border p-2"
        />
        <input
          placeholder="เลขสมาชิก"
          value={form.memberId}
          onChange={(e) => setForm({ ...form, memberId: e.target.value })}
          className="border p-2"
        />
        <input
          placeholder="อายุ"
          type="number"
          value={form.age}
          onChange={(e) => setForm({ ...form, age: e.target.value })}
          className="border p-2"
        />
        <select
          value={form.machineId}
          onChange={(e) => setForm({ ...form, machineId: e.target.value })}
          className="border p-2"
        >
          {DEFAULT_MACHINES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="border p-2"
        >
          {days.map((d) => (
            <option key={dateKey(d)} value={dateKey(d)}>
              {prettyDate(d)}
            </option>
          ))}
        </select>
        <select
          value={form.slotId}
          onChange={(e) => setForm({ ...form, slotId: e.target.value })}
          className="border p-2"
        >
          {SLOTS.map((s) => (
            <option
              key={s.id}
              value={s.id}
              disabled={
                hasConflict(form.machineId, form.date, s.id) ||
                isPastSlot(form.date, s.id)
              }
            >
              {s.label}
              {isPastSlot(form.date, s.id) ? " (ผ่านไปแล้ว)" : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-emerald-600 text-white p-2 rounded"
          disabled={saving}
        >
          {saving ? "กำลังบันทึก…" : "จองใช้งาน"}
        </button>
      </form>

      <h2 className="font-semibold mb-2">ตารางจอง (เฉพาะอนาคต)</h2>
      {loading && (
        <div className="text-sm text-slate-500">กำลังโหลดข้อมูล…</div>
      )}
      {apiError && (
        <div className="text-xs text-red-600 whitespace-pre-wrap border rounded p-2 mb-2 bg-red-50">
          {apiError}
        </div>
      )}
      <ul>
        {bookings.filter(isFutureBooking).map((b) => (
          <li key={b.id} className="border p-2 mb-1">
            {formatBookingLine(b)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApiConfig({ apiUrl, setApiUrl, onTest, status }) {
  const { loading, lastFetchedAt, apiError } = status;
  const valid = isLikelyAppsScriptUrl(apiUrl);
  return (
    <div className="border rounded-xl p-3 mb-4 bg-white">
      <div className="text-sm font-medium mb-2">
        การเชื่อมต่อฐานข้อมูล (Google Apps Script)
      </div>
      <div className="flex flex-col md:flex-row gap-2 items-start md:items-center">
        <input
          className={`border p-2 w-full md:flex-1 ${
            valid ? "border-emerald-400" : "border-slate-300"
          }`}
          placeholder="https://script.google.com/macros/s/XXXXXXXX/exec"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
        />
        <button
          className="border rounded px-3 py-2"
          onClick={onTest}
          disabled={loading}
        >
          {loading ? "กำลังทดสอบ…" : "เรียกดูตารางจอง"}
        </button>
      </div>
      <div className="text-xs text-slate-600 mt-2">
        สถานะ:{" "}
        {valid ? "พร้อมเชื่อมต่อ" : "URL ยังไม่ถูกต้อง (ต้องลงท้าย /exec)"}
        {lastFetchedAt ? ` • โหลดล่าสุด: ${lastFetchedAt}` : ""}
      </div>
      {apiError && <div className="text-xs text-red-600 mt-1">{apiError}</div>}
    </div>
  );
}
