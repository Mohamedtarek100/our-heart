export default async function run(page) {
  const out = { requests: [], snapshots: {} };
  const base = "http://127.0.0.1:5500/index.html";
  const tracked = (url) => /(?:access|intro)\.(?:js|css)/.test(url);
  page.on("request", (request) => { if (tracked(request.url())) out.requests.push(request.url()); });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("ourHeartAccessGrantedAt", String(Date.now()));
    localStorage.setItem("currentUser", "Mohamed");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  out.autoEarly = await snapshot(page);
  if (await page.locator("#romanticIntro").count()) {
    await page.click("#romanticIntro .intro-skip");
    await page.waitForTimeout(1400);
  }

  out.beforeReplay = await page.evaluate(() => ({
    overlays: document.querySelectorAll("#romanticIntro").length,
    button: !!document.getElementById("loveIntroButton"),
    chat: !!document.getElementById("chatBox"),
    overflow: document.body.style.overflow,
    link: document.getElementById("romanticIntroStyles")?.getAttribute("href") || null
  }));

  await page.click("#loveIntroButton");
  for (const [label, delay] of [["100ms", 100], ["300ms", 200], ["500ms", 200], ["1s", 500], ["2s", 1000], ["4s", 2000], ["6s", 2000], ["9s", 3000], ["12s", 3000]]) {
    await page.waitForTimeout(delay);
    out.snapshots[label] = await snapshot(page);
    if (label === "500ms") await page.screenshot({ path: "replay-500ms.png" });
    if (label === "4s") await page.screenshot({ path: "replay-4s.png" });
    if (label === "12s") await page.screenshot({ path: "replay-12s.png" });
  }
  out.buttonDisabled = await page.evaluate(() => document.getElementById("loveIntroButton")?.disabled);
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  out.afterReplay = await page.evaluate(() => ({
    overlays: document.querySelectorAll("#romanticIntro").length,
    overflow: document.body.style.overflow,
    inert: document.getElementById("mainApp")?.inert,
    chat: !!document.getElementById("chatBox"),
    controls: ["sendBtn", "recordBtn", "stickerBtn", "gifBtn", "messageInput"].every((id) => !!document.getElementById(id)),
    buttonDisabled: document.getElementById("loveIntroButton")?.disabled
  }));

  await page.click("#loveIntroButton");
  await page.waitForTimeout(300);
  await page.click("#loveIntroButton").catch(() => { });
  await page.waitForTimeout(200);
  out.doubleClick = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, scenes: Array.from(document.getElementById("romanticIntro")?.classList || []) }));
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  out.final = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, overflow: document.body.style.overflow, sessionFlag: sessionStorage.getItem("ourHeartIntroShown") }));
  return out;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const root = document.getElementById("romanticIntro");
    if (!root) return { present: false };
    const q = (selector) => root.querySelector(selector);
    const style = (selector) => {
      const element = q(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return { opacity: Number(computed.opacity).toFixed(2), transform: computed.transform, visibility: computed.visibility, display: computed.display };
    };
    const animations = (selector) => {
      const element = q(selector);
      return element?.getAnimations?.().map((animation) => ({ name: animation.animationName, state: animation.playState, currentTime: Math.round(Number(animation.currentTime) || 0) })) || [];
    };
    return {
      present: true,
      classes: Array.from(root.classList),
      heart: style(".intro-heart"),
      heartSvg: style(".intro-heart svg"),
      heartAnimations: animations(".intro-heart"),
      svgAnimations: animations(".intro-heart svg"),
      glow: style(".intro-glow"),
      glowAnimations: animations(".intro-glow"),
      rays: style(".intro-rays"),
      rings: animations(".intro-ring"),
      eyebrow: style(".intro-eyebrow"),
      line1: style(".intro-line--1"),
      line2: style(".intro-line--2"),
      subtitle: style(".intro-subtitle"),
      particleCanvas: !!q(".intro-particles")
    };
  });
}
