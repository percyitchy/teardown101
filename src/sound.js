// All audio is synthesized with Web Audio: UI clicks, chimes, request blips and a lo-fi workbench loop.
// Nothing is downloaded. Starts on the first click (browsers block autoplay).

export function createSound() {
	const Ctx = window.AudioContext || window.webkitAudioContext;
	let ctx = null, master, sfx, music, verb, started = false;
	let on = true;
	try { on = localStorage.getItem("teardown101.sound") !== "off"; } catch {}

	function init() {
		if (ctx || !Ctx) return;
		ctx = new Ctx();
		master = ctx.createGain(); master.gain.value = on ? 1 : 0;
		const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
		master.connect(comp).connect(ctx.destination);
		sfx = ctx.createGain(); sfx.gain.value = 0.55; sfx.connect(master);
		music = ctx.createGain(); music.gain.value = 0; music.connect(master);
		verb = ctx.createConvolver();
		const len = ctx.sampleRate * 2, b = ctx.createBuffer(2, len, ctx.sampleRate);
		for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
		verb.buffer = b; const vg = ctx.createGain(); vg.gain.value = 0.28; verb.connect(vg).connect(music);
	}

	const noiseBuf = () => { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
	let NB = null;
	function tone({ f = 440, type = "sine", t = 0, a = 0.004, d = 0.12, v = 0.2, to = null, out = null, fEnd = null }) {
		if (!ctx) return;
		const o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + t;
		o.type = type; o.frequency.setValueAtTime(f, at); if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, at + d);
		g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
		o.connect(g).connect(out || sfx); if (to) g.connect(to);
		o.start(at); o.stop(at + a + d + 0.05);
	}
	function noise({ t = 0, d = 0.05, v = 0.1, f = 3000, q = 1, type = "bandpass", out = null }) {
		if (!ctx) return;
		NB ||= noiseBuf();
		const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(), at = ctx.currentTime + t;
		s.buffer = NB; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
		g.gain.setValueAtTime(v, at); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
		s.connect(fl).connect(g).connect(out || sfx); s.start(at, Math.random() * 0.5); s.stop(at + d + 0.02);
	}

	// ------------------------------------------------ sound effects
	const fx = {
		click() { noise({ d: 0.03, v: 0.18, f: 4200, q: 3 }); tone({ f: 1800, d: 0.025, v: 0.04, type: "triangle" }); },
		tap() { tone({ f: 620, fEnd: 880, d: 0.07, v: 0.12, type: "sine" }); },
		pick() { noise({ d: 0.05, v: 0.25, f: 2400, q: 2 }); tone({ f: 1320, d: 0.05, v: 0.06, type: "square", t: 0.01 }); },
		request(method, status) {
			if (status >= 400) { tone({ f: 180, d: 0.22, v: 0.14, type: "sawtooth" }); tone({ f: 120, d: 0.25, v: 0.12, type: "square", t: 0.08 }); return; }
			const f = { GET: 1560, POST: 1980, PATCH: 1760 }[method] || 1500;
			tone({ f, d: 0.04, v: 0.035, type: "sine" });
		},
		task() { [784, 1175].forEach((f, i) => tone({ f, d: 0.28, v: 0.14, type: "triangle", t: i * 0.09, to: verb })); },
		lesson() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.45, v: 0.13, type: "triangle", t: i * 0.1, to: verb })); tone({ f: 2093, d: 0.6, v: 0.04, t: 0.42, to: verb }); },
		page() { noise({ d: 0.14, v: 0.08, f: 1800, q: 0.6 }); },
		type() { noise({ d: 0.02, v: 0.06, f: 3500, q: 4 }); },
	};

	// ------------------------------------------------ lo-fi workbench loop (Fmaj7 Em7 Dm7 Cmaj7, 76 bpm)
	const BPM = 76, STEP = 60 / BPM / 4;
	const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
	const CH = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
	const BASS = [41, 40, 38, 36];
	let step = 0, nextT = 0, timer = null;
	function keys(t, notes, dur) {
		for (const n of notes) {
			const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
			o.type = "sine"; o2.type = "triangle"; o.frequency.value = midi(n); o2.frequency.value = midi(n) * 2.001;
			lp.type = "lowpass"; lp.frequency.value = 1400;
			const g2 = ctx.createGain(); g2.gain.value = 0.18;
			g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
			o.connect(g); o2.connect(g2).connect(g); g.connect(lp); lp.connect(music); lp.connect(verb);
			o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
		}
	}
	function schedule() {
		// after the tab was in the background, never replay a backlog of missed steps at once
		if (nextT < ctx.currentTime - 0.05) nextT = ctx.currentTime + 0.05;
		while (nextT < ctx.currentTime + 0.2) {
			const bar = Math.floor(step / 16) % 4, s = step % 16, t = nextT;
			if (s === 0 || s === 10) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g).connect(music); o.start(t); o.stop(t + 0.32); }
			if (s === 4 || s === 12) { NB ||= noiseBuf(); const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = NB; f.type = "bandpass"; f.frequency.value = 1700; f.Q.value = 0.8; g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); n.connect(f).connect(g); g.connect(music); g.connect(verb); n.start(t, Math.random() * 0.5); n.stop(t + 0.2); }
			if (s % 2 === 0) { NB ||= noiseBuf(); const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = NB; f.type = "highpass"; f.frequency.value = 7500; g.gain.setValueAtTime(s % 4 ? 0.006 : 0.011, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); n.connect(f).connect(g).connect(music); n.start(t, Math.random() * 0.5); n.stop(t + 0.05); }
			if (s === 0) keys(t + 0.01, CH[bar], STEP * 15);
			if (s === 8) keys(t + 0.02, CH[bar].slice(1), STEP * 7);
			if (s === 0 || s === 7 || s === 11) { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = "triangle"; o.frequency.value = midi(BASS[bar] + (s === 11 ? 7 : 0)); f.type = "lowpass"; f.frequency.value = 500; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 3.5); o.connect(f).connect(g).connect(music); o.start(t); o.stop(t + STEP * 4); }
			step++; nextT += STEP;
		}
	}

	function start() {
		init(); if (!ctx) return;
		ctx.resume();
		if (started) return;
		started = true;
		nextT = ctx.currentTime + 0.1; timer = setInterval(schedule, 40);
		music.gain.setTargetAtTime(0.35, ctx.currentTime, 1.2);
	}

	document.addEventListener("visibilitychange", () => {
		if (!ctx || !started) return;
		if (document.hidden) ctx.suspend(); else if (on) { ctx.resume(); nextT = ctx.currentTime + 0.05; }
	});

	return {
		start,
		play(name, ...args) { if (!on || !ctx || ctx.state !== "running") return; fx[name]?.(...args); },
		toggle() {
			on = !on;
			try { localStorage.setItem("teardown101.sound", on ? "on" : "off"); } catch {}
			if (ctx) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05);
			if (on) start();
			return on;
		},
		get on() { return on; },
	};
}
