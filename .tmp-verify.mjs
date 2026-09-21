export default async function run(page) {
  const out = {};
  const base = "http://127.0.0.1:5500/index.html";
  const overlays = () => page.evaluate(() => document.querySelectorAll("#romanticIntro").length);
  const scenes = () =>
    page.evaluate(() =>
      Array.from(document.getElementById("romanticIntro")?.classList || []).filter((c) =>
        c.startsWith("scene-")
      )
    );

  await page.setViewportSize({ width: 390, height: 844 });

  // ---- A. Fresh automatic intro starts from Scene 1 ----
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("ourHeartAccessGrantedAt", String(Date.now()));
    localStorage.setItem("currentUser", "Mohamed");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  out.A_autoShown = (await overlays()) === 1;
  out.A_earlyHidden = await page.evaluate(() => {
    const r = document.getElementById("romanticIntro");
    if (!r) return null;
    const h = r.querySelector(".intro-heart");
    return {
      scenes: Array.from(r.classList).filter((c) => c.startsWith("scene-")),
      heartOp: Number(getComputedStyle(h).opacity).toFixed(2)
    };
  });

  // ---- B. Skip works ----
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  out.B_afterSkip = {
    overlays: await overlays(),
    overflow: await page.evaluate(() => document.body.style.overflow),
    chatBox: await page.evaluate(() => !!document.getElementById("chatBox"))
  };

  // ---- C. Click Love Intro -> visibly starts from Scene 1 ----
  const grab = async (label, wait) => {
    await page.waitForTimeout(wait);
    out[label] = await page.evaluate(() => {
      const r = document.getElementById("romanticIntro");
      if (!r) return { present: false };
      const q = (s) => r.querySelector(s);
      const op = (s) => {
        const el = q(s);
        return el ? Number(getComputedStyle(el).opacity).toFixed(2) : null;
      };
      return {
        scenes: Array.from(r.classList).filter((c) => c.startsWith("scene-")),
        heartOp: op(".intro-heart"),
        heartTf: q(".intro-heart") ? getComputedStyle(q(".intro-heart")).transform.slice(0, 22) : null,
        glowOp: op(".intro-glow"),
        eyebrowOp: op(".intro-eyebrow"),
        line1Op: op(".intro-line--1"),
        line2Op: op(".intro-line--2"),
        subtitleOp: op(".intro-subtitle")
      };
    });
  };
  await page.click("#loveIntroButton");
  await grab("C_t_0_1s", 100);
  await grab("C_t_1s", 900);
  await grab("C_t_2s", 1000);
  await grab("C_t_4s", 2000);
  await grab("C_t_6s", 2000);
  await grab("C_t_9s", 3000);
  await grab("C_t_12s", 3000);
  out.C_disabledDuring = await page.evaluate(
    () => document.getElementById("loveIntroButton")?.disabled
  );

  // ---- D. Skip replay -> returns to chat ----
  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);
  out.D_afterReplaySkip = {
    overlays: await overlays(),
    overflow: await page.evaluate(() => document.body.style.overflow),
    chatBox: await page.evaluate(() => !!document.getElementById("chatBox")),
    btnReEnabled: await page.evaluate(
      () => document.getElementById("loveIntroButton")?.disabled === false
    )
  };

  // ---- E. Click Love Intro again -> Scene 1 again ----
  await page.click("#loveIntroButton");
  await page.waitForTimeout(300);
  out.E_secondReplayScenes = await scenes();
  out.E_secondFromScene1 = (out.E_secondReplayScenes || []).includes("scene-atmosphere");

  // ---- F. Double click -> only one overlay ----
  await page.click("#loveIntroButton", { force: true }).catch(() => { });
  await page.waitForTimeout(300);
  out.F_overlaysAfterDoubleClick = await overlays();

  await page.click("#romanticIntro .intro-skip");
  await page.waitForTimeout(1400);

  // ---- H. No duplicate overlays/listeners ----
  out.H_finalOverlays = await overlays();

  // ---- I. Chat state intact ----
  out.I_chat = await page.evaluate(() => ({
    chatBox: !!document.getElementById("chatBox"),
    sendBtn: !!document.getElementById("sendBtn"),
    recordBtn: !!document.getElementById("recordBtn"),
    stickerBtn: !!document.getElementById("stickerBtn"),
    gifBtn: !!document.getElementById("gifBtn"),
    input: !!document.getElementById("messageInput"),
    loveBtn: !!document.getElementById("loveIntroButton"),
    loveBtnDisabled: document.getElementById("loveIntroButton")?.disabled
  }));

  return out;
}
