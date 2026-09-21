export default async function run(page) {
  const out = {};
  const base = "http://127.0.0.1:5500/index.html";
  const count = () => page.evaluate(() => document.querySelectorAll("#romanticIntro").length);
  async function goChat(user = "Mohamed") {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate((u) => {
      localStorage.setItem("ourHeartAccessGrantedAt", String(Date.now()));
      localStorage.setItem("currentUser", u);
      sessionStorage.setItem("ourHeartIntroShown", "1");
    }, user);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await goChat();
  await page.click("#loveIntroButton");
  await page.waitForTimeout(400);
  out.replay = await page.evaluate(() => ({
    overlays: document.querySelectorAll("#romanticIntro").length,
    scenes: Array.from(document.getElementById("romanticIntro")?.classList || []),
    heartOpacity: getComputedStyle(document.querySelector("#romanticIntro .intro-heart")).opacity
  }));
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  out.afterSkip = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, overflow: document.body.style.overflow, inert: document.getElementById("mainApp")?.inert, chat: !!document.getElementById("chatBox") }));
  await page.click("#loveIntroButton");
  await page.waitForTimeout(250);
  await page.click("#loveIntroButton").catch(() => { });
  await page.waitForTimeout(250);
  out.double = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, scenes: Array.from(document.getElementById("romanticIntro")?.classList || []) }));
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  await page.click("#loveIntroButton");
  await page.waitForTimeout(250);
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  out.repeat = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, buttonDisabled: document.getElementById("loveIntroButton")?.disabled, overflow: document.body.style.overflow }));

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.click("#loveIntroButton");
  await page.waitForTimeout(700);
  out.reduced = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, heart: getComputedStyle(document.querySelector("#romanticIntro .intro-heart")).opacity, line: getComputedStyle(document.querySelector("#romanticIntro .intro-line--1")).opacity, skip: getComputedStyle(document.querySelector("#romanticIntro .intro-skip")).opacity }));
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(700);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Natural completion.
  await page.click("#loveIntroButton");
  await page.waitForTimeout(23000);
  out.natural = await page.evaluate(() => ({ overlays: document.querySelectorAll("#romanticIntro").length, overflow: document.body.style.overflow, chat: !!document.getElementById("chatBox"), flag: sessionStorage.getItem("ourHeartIntroShown") }));

  const viewports = [[360, 800], [390, 844], [430, 932], [1366, 768], [1920, 1080], [844, 390]];
  out.viewports = {};
  for (const [w, h] of viewports) {
    await page.setViewportSize({ width: w, height: h });
    await goChat();
    await page.click("#loveIntroButton");
    await page.waitForTimeout(400);
    out.viewports[w + "x" + h] = await page.evaluate(() => {
      const r = document.getElementById("romanticIntro");
      const title = r.querySelector(".intro-title"), heart = r.querySelector(".intro-heart"), skip = r.querySelector(".intro-skip");
      const fits = (el) => { const b = el.getBoundingClientRect(); return b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1; };
      return { scene1: r.classList.contains("scene-atmosphere"), heartHidden: getComputedStyle(heart).opacity === "0", titleFits: title.scrollWidth <= title.clientWidth + 1 && fits(title), heartFits: fits(heart), skipFits: fits(skip), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    await page.click("#romanticIntro .intro-skip");
    await page.waitForTimeout(1300);
  }
  return out;
}
