// Pulse: a fictional habit tracker that the lessons take apart.
// Everything here is fake on purpose: fake API, fake storage, fake bundle. Nothing leaves the page.

const HISTORY = (s) => Array.from({ length: 7 }, (_, i) => (s >> i) & 1);

export function createPulse(root, bus) {
	const state = {
		screen: "home",
		habitId: null,
		statsRange: "7d",
		user: { id: "u_8f21c", name: "Alex", plan: "free", created_at: "2026-03-14T09:21:00Z" },
		habits: [
			{ id: "h_01", name: "Read 20 pages", color: "#6D5DFC", streak: 12, done: false, remind_at: "21:30", history: HISTORY(0b1111011) },
			{ id: "h_02", name: "Morning run", color: "#FF7A59", streak: 4, done: true, remind_at: "07:00", history: HISTORY(0b1011101) },
			{ id: "h_03", name: "No sugar", color: "#1FAE7A", streak: 0, done: false, remind_at: null, history: HISTORY(0b0010110) },
		],
		settings: { theme: "light", reminders: true, week_start: "mon" },
	};

	// ---------------------------------------------------------------- fake storage
	const storage = {
		localStorage: { "pulse.theme": "light", "pulse.onboarded": "true", "pulse.last_screen": "home" },
		sessionStorage: { "pulse.tab_id": "t_" + Math.random().toString(36).slice(2, 8) },
		cookies: { pulse_session: "demo_s3ss10n_7Kq9xV2mPz", pulse_ab: "paywall_b", pulse_locale: "en-US" },
	};
	function setStore(area, key, value) {
		const old = storage[area][key];
		storage[area][key] = value;
		bus.emit("storage", { area, key, value, old });
	}

	// ---------------------------------------------------------------- fake network
	let reqId = 0;
	const BASE = "https://api.pulse.app";
	function api(method, path, body, handler) {
		const started = performance.now();
		const ms = 38 + Math.round(Math.random() * 140);
		return new Promise((resolve) => {
			setTimeout(() => {
				const [status, res] = handler();
				const rec = {
					id: ++reqId, method, path, url: BASE + path, status, ms, time: Date.now(),
					kind: path.startsWith("/api/v2/events") ? "analytics" : "fetch",
					reqHeaders: {
						accept: "application/json",
						"content-type": body ? "application/json" : undefined,
						"x-client": "pulse-web/3.18.2",
						"x-ab": storage.cookies.pulse_ab,
						authorization: "Bearer ••••••••",
					},
					resHeaders: { "content-type": res instanceof Uint8Array ? "application/x-pulse-backup" : "application/json", "x-request-id": "req_" + (1000 + reqId), "cache-control": "no-store" },
					body, response: res, started,
				};
				bus.emit("request", rec);
				resolve([status, res]);
			}, ms);
		});
	}
	function track(event, props = {}) {
		api("POST", "/api/v2/events", { event, props: { ...props, ab: storage.cookies.pulse_ab }, ts: new Date().toISOString() }, () => [204, null]);
	}

	// ---------------------------------------------------------------- navigation
	function go(to, via, extra = {}) {
		const from = state.screen;
		Object.assign(state, extra, { screen: to });
		setStore("localStorage", "pulse.last_screen", to);
		bus.emit("nav", { from, to, via });
		track("screen_view", { screen: to });
		render();
		if (to === "home") api("GET", "/api/v2/habits", null, () => [200, { items: state.habits.map(pub), limit: 3, plan: state.user.plan }]);
		if (to === "habit") api("GET", `/api/v2/habits/${state.habitId}`, null, () => [200, { ...pub(habit()), remind_at: habit().remind_at, history: habit().history }]);
		if (to === "stats") loadStats();
		if (to === "settings") api("GET", "/api/v2/settings", null, () => [200, { ...state.settings }]);
		if (to === "pro") api("GET", "/api/v2/plans", null, () => [200, { variant: "paywall_b", plans: [{ id: "pro_monthly", price: 4.99, currency: "USD", trial_days: 7 }, { id: "pro_yearly", price: 29.99, currency: "USD", trial_days: 7 }] }]);
	}
	const habit = () => state.habits.find((h) => h.id === state.habitId) || state.habits[0];
	const pub = (h) => ({ id: h.id, name: h.name, color: h.color, streak: h.streak, done_today: h.done });

	function loadStats() {
		const range = state.statsRange;
		api("GET", `/api/v2/stats?range=${range}`, null, () => {
			if (range === "30d" && state.user.plan === "free") return [402, { error: "pro_only", feature: "stats_30d", upgrade_url: "/pro" }];
			const total = state.habits.reduce((a, h) => a + h.history.reduce((x, y) => x + y, 0), 0);
			return [200, { range, completion: +(total / (state.habits.length * 7)).toFixed(2), best_streak: Math.max(...state.habits.map((h) => h.streak)), days: [0, 1, 2, 3, 4, 5, 6].map((d) => state.habits.reduce((a, h) => a + h.history[d], 0)) }];
		}).then(([status]) => {
			if (status === 402) { toast("30-day stats are a Pro feature"); setTimeout(() => go("pro", "402 from /stats"), 700); }
		});
	}

	function toast(msg) {
		const t = root.querySelector(".pl-toast");
		if (!t) return;
		t.textContent = msg; t.classList.add("show");
		clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove("show"), 1800);
	}

	// ---------------------------------------------------------------- export (binary file format lesson)
	function buildBackup() {
		const json = new TextEncoder().encode(JSON.stringify({ v: 2, user: state.user.id, habits: state.habits.map((h) => ({ id: h.id, n: h.name, s: h.streak, h: h.history.join("") })) }));
		const head = new Uint8Array(12);
		head.set([0x50, 0x4c, 0x53, 0x42], 0); // "PLSB"
		head[4] = 2; // version
		head[5] = 0; // flags
		head[6] = (state.habits.length >> 8) & 255; head[7] = state.habits.length & 255; // u16 count
		const n = json.length; head[8] = (n >>> 24) & 255; head[9] = (n >>> 16) & 255; head[10] = (n >>> 8) & 255; head[11] = n & 255; // u32 length
		const out = new Uint8Array(12 + n + 4);
		out.set(head, 0); out.set(json, 12);
		const c = crc32(out.subarray(0, 12 + n));
		out[12 + n] = (c >>> 24) & 255; out[13 + n] = (c >>> 16) & 255; out[14 + n] = (c >>> 8) & 255; out[15 + n] = c & 255;
		return out;
	}

	// ---------------------------------------------------------------- actions
	function toggleHabit(id) {
		const h = state.habits.find((x) => x.id === id);
		h.done = !h.done; h.streak = Math.max(0, h.streak + (h.done ? 1 : -1)); h.history[6] = h.done ? 1 : 0;
		render();
		api("POST", `/api/v2/habits/${id}/${h.done ? "check" : "uncheck"}`, { date: new Date().toISOString().slice(0, 10) }, () => [200, { id, streak: h.streak, done_today: h.done }]);
		track(h.done ? "habit_checked" : "habit_unchecked", { habit: id });
	}
	function addHabit() {
		api("POST", "/api/v2/habits", { name: "Drink water", color: "#2D9CDB" }, () => state.user.plan === "free" && state.habits.length >= 3
			? [402, { error: "plan_limit", limit: 3, upgrade_url: "/pro" }]
			: [201, { id: "h_04" }]).then(([status]) => {
			if (status === 402) { toast("Free plan: 3 habits max"); setTimeout(() => go("pro", "402 on add habit"), 700); }
		});
	}
	function setTheme(theme) {
		state.settings.theme = theme; setStore("localStorage", "pulse.theme", theme); render();
		api("PATCH", "/api/v2/settings", { theme }, () => [200, { ...state.settings }]);
	}
	function setReminders(v) {
		state.settings.reminders = v; render();
		api("PATCH", "/api/v2/settings", { reminders: v }, () => [200, { ...state.settings }]);
	}
	function exportData() {
		const bytes = buildBackup();
		api("GET", "/api/v2/export?format=plsb", null, () => [200, bytes]).then(() => { bus.emit("export", bytes); toast("Backup exported: pulse.plsb"); });
	}
	function startTrial() {
		api("POST", "/api/v2/checkout", { plan: "pro_yearly" }, () => [200, { checkout_url: "https://pay.pulse.app/c/demo", mode: "trial" }]).then(() => toast("Demo app: no real checkout"));
		track("paywall_cta", { plan: "pro_yearly" });
	}

	// ---------------------------------------------------------------- views
	const icon = {
		home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
		stats: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
		settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
		back: '<path d="M15 5l-7 7 7 7"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
	};
	const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon[n]}</svg>`;
	const days = ["M", "T", "W", "T", "F", "S", "S"];

	function viewHome() {
		const done = state.habits.filter((h) => h.done).length;
		return `
		<header class="pl-top"><div><div class="pl-hello">Good evening, ${state.user.name}</div><h1 class="pl-title">Today</h1></div><span class="pl-badge">${state.user.plan.toUpperCase()}</span></header>
		<div class="pl-progress"><div class="pl-progress-label">${done} of ${state.habits.length} done</div><div class="pl-bar"><i style="width:${(done / state.habits.length) * 100}%"></i></div></div>
		<ul class="pl-list">${state.habits.map((h) => `
			<li class="pl-card" data-open="${h.id}">
				<span class="pl-dot" style="background:${h.color}"></span>
				<div class="pl-card-body"><div class="pl-card-title">${h.name}</div><div class="pl-card-meta">🔥 ${h.streak} day streak</div></div>
				<button class="pl-check ${h.done ? "on" : ""}" data-check="${h.id}" style="--c:${h.color}" aria-label="Check ${h.name}">${svg("check")}</button>
			</li>`).join("")}
		</ul>
		<button class="pl-btn pl-btn--ghost" data-add>${svg("plus")} New habit</button>`;
	}
	function viewHabit() {
		const h = habit();
		return `
		<header class="pl-top pl-top--sub"><button class="pl-icon" data-back>${svg("back")}</button><h1 class="pl-title pl-title--sm">${h.name}</h1><span></span></header>
		<div class="pl-hero" style="--c:${h.color}"><div class="pl-hero-num">${h.streak}</div><div class="pl-hero-label">day streak</div></div>
		<div class="pl-week">${h.history.map((v, i) => `<div class="pl-day ${v ? "on" : ""}" style="--c:${h.color}"><b>${days[i]}</b><i></i></div>`).join("")}</div>
		<div class="pl-row"><span>Reminder</span><b>${h.remind_at || "Off"}</b></div>
		<button class="pl-btn pl-btn--primary" data-check="${h.id}" style="--c:${h.color}">${h.done ? "Done today ✓" : "Mark as done"}</button>`;
	}
	function viewStats() {
		const d = [0, 1, 2, 3, 4, 5, 6].map((i) => state.habits.reduce((a, h) => a + h.history[i], 0));
		return `
		<header class="pl-top"><h1 class="pl-title">Stats</h1><div class="pl-seg"><button class="${state.statsRange === "7d" ? "on" : ""}" data-range="7d">7 days</button><button class="${state.statsRange === "30d" ? "on" : ""}" data-range="30d">30 days</button></div></header>
		<div class="pl-chart">${d.map((v, i) => `<div class="pl-col"><i style="height:${(v / state.habits.length) * 100}%"></i><b>${days[i]}</b></div>`).join("")}</div>
		<div class="pl-tiles"><div class="pl-tile"><b>${Math.round((d.reduce((a, b) => a + b, 0) / (7 * state.habits.length)) * 100)}%</b><span>completion</span></div><div class="pl-tile"><b>${Math.max(...state.habits.map((h) => h.streak))}</b><span>best streak</span></div></div>`;
	}
	function viewSettings() {
		const s = state.settings;
		return `
		<header class="pl-top"><h1 class="pl-title">Settings</h1></header>
		<div class="pl-group">
			<div class="pl-row"><span>Dark mode</span><button class="pl-switch ${s.theme === "dark" ? "on" : ""}" data-theme-toggle aria-label="Dark mode"><i></i></button></div>
			<div class="pl-row"><span>Reminders</span><button class="pl-switch ${s.reminders ? "on" : ""}" data-remind aria-label="Reminders"><i></i></button></div>
			<div class="pl-row"><span>Week starts</span><b>Monday</b></div>
		</div>
		<div class="pl-group">
			<button class="pl-row pl-row--btn" data-export><span>Export backup</span><b>.plsb</b></button>
			<button class="pl-row pl-row--btn" data-go-pro><span>Pulse Pro</span><b>Upgrade →</b></button>
		</div>
		<div class="pl-foot">Pulse web 3.18.2</div>`;
	}
	function viewPro() {
		return `
		<header class="pl-top pl-top--sub"><button class="pl-icon" data-back>${svg("back")}</button><span></span><span></span></header>
		<div class="pl-pro">
			<div class="pl-pro-badge">PRO</div>
			<h1 class="pl-title">Build habits that stick</h1>
			<ul class="pl-perks"><li>Unlimited habits</li><li>30-day and yearly stats</li><li>Streak freeze, 2 per month</li></ul>
			<div class="pl-plan on"><div><b>Yearly</b><span>7-day free trial</span></div><b>$29.99</b></div>
			<div class="pl-plan"><div><b>Monthly</b><span>cancel anytime</span></div><b>$4.99</b></div>
			<button class="pl-btn pl-btn--primary" data-trial style="--c:#6D5DFC">Start free trial</button>
		</div>`;
	}

	function render() {
		const views = { home: viewHome, habit: viewHabit, stats: viewStats, settings: viewSettings, pro: viewPro };
		const tab = state.screen === "habit" ? "home" : state.screen;
		root.className = `pulse ${state.settings.theme === "dark" ? "pulse--dark" : ""}`;
		root.innerHTML = `
		<div class="pl-screen" data-screen="${state.screen}">${views[state.screen]()}</div>
		${state.screen === "pro" ? "" : `<nav class="pl-tabs">
			<button class="${tab === "home" ? "on" : ""}" data-tab="home">${svg("home")}<span>Today</span></button>
			<button class="${tab === "stats" ? "on" : ""}" data-tab="stats">${svg("stats")}<span>Stats</span></button>
			<button class="${tab === "settings" ? "on" : ""}" data-tab="settings">${svg("settings")}<span>Settings</span></button>
		</nav>`}
		<div class="pl-toast"></div>`;
	}

	root.addEventListener("click", (e) => {
		if (root.dataset.inspect) return; // inspector owns clicks
		const t = e.target.closest("button, [data-open]");
		if (!t || !root.contains(t)) return;
		const d = t.dataset;
		if (d.check) { e.stopPropagation(); return toggleHabit(d.check); }
		if (d.open) return go("habit", "tap habit", { habitId: d.open });
		if (d.tab) return state.screen !== d.tab && go(d.tab, "tab " + d.tab);
		if ("back" in d) return go(state.screen === "pro" ? "settings" : "home", "back");
		if ("add" in d) return addHabit();
		if (d.range) { state.statsRange = d.range; render(); return loadStats(); }
		if ("themeToggle" in d) return setTheme(state.settings.theme === "dark" ? "light" : "dark");
		if ("remind" in d) return setReminders(!state.settings.reminders);
		if ("export" in d) return exportData();
		if ("goPro" in d) return go("pro", "tap Upgrade");
		if ("trial" in d) return startTrial();
	});

	function boot() {
		render();
		bus.emit("nav", { from: null, to: "home", via: "open app" });
		api("GET", "/api/v2/me", null, () => [200, { ...state.user }]);
		api("GET", "/api/v2/habits", null, () => [200, { items: state.habits.map(pub), limit: 3, plan: state.user.plan }]);
		track("app_open", { screen: "home" });
	}

	return { boot, state, storage, buildBackup, exportData, go };
}

// ---------------------------------------------------------------- crc32
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ---------------------------------------------------------------- a fake production bundle for the "read the bundle" lesson
export const BUNDLE_MIN = `"use strict";(self.webpackChunkpulse=self.webpackChunkpulse||[]).push([[179],{4417:(e,t,n)=>{n.d(t,{Z:()=>s});const r=n(2784),a="https://api.pulse.app/api/v2",o={ff_streak_freeze:!1,ff_paywall_v3:!0,ff_ai_coach:!1,stats_free_range:"7d",free_habit_limit:3};function i(e){return fetch(a+e,{headers:{"x-client":"pulse-web/3.18.2"}}).then(e=>e.json())}function s(){const[e,t]=(0,r.useState)([]);return(0,r.useEffect)(()=>{i("/habits").then(e=>t(e.items))},[]),e.length>=o.free_habit_limit&&"free"===c().plan?u("/pro"):null}function c(){return JSON.parse(localStorage.getItem("pulse.user")||"{}")}function u(e){window.__pl.track("paywall_view",{from:e,v:o.ff_paywall_v3?"b":"a"})}},8810:(e,t,n)=>{const r=n(4417);function a(e){return e.ff_ai_coach?r.Z():null}}}]);`;

export const BUNDLE_PRETTY = `"use strict";
(self.webpackChunkpulse = self.webpackChunkpulse || []).push([[179], {
  4417: (e, t, n) => {
    n.d(t, { Z: () => s });
    const r = n(2784),
      a = "https://api.pulse.app/api/v2",
      o = {
        ff_streak_freeze: !1,
        ff_paywall_v3: !0,
        ff_ai_coach: !1,
        stats_free_range: "7d",
        free_habit_limit: 3
      };

    function i(e) {
      return fetch(a + e, { headers: { "x-client": "pulse-web/3.18.2" } })
        .then(e => e.json());
    }

    function s() {
      const [e, t] = (0, r.useState)([]);
      (0, r.useEffect)(() => { i("/habits").then(e => t(e.items)); }, []);
      return e.length >= o.free_habit_limit && "free" === c().plan ? u("/pro") : null;
    }

    function c() {
      return JSON.parse(localStorage.getItem("pulse.user") || "{}");
    }

    function u(e) {
      window.__pl.track("paywall_view", { from: e, v: o.ff_paywall_v3 ? "b" : "a" });
    }
  },
  8810: (e, t, n) => {
    const r = n(4417);
    function a(e) {
      return e.ff_ai_coach ? r.Z() : null;
    }
  }
}]);`;
