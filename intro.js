var j="romanticIntroStyles",X="intro.css?v=8";var h={atmosphere:0,heart:2600,gather:6200,revealEyebrow:8600,revealLine1:9700,revealLine2:10800,finalMessage:12600,settle:16500,exit:19800,done:21200};function se(){return typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches}function le(){let c=document.getElementById(j);return c?.getAttribute("href")===X&&c.sheet?Promise.resolve():(c?.remove(),new Promise((s,p)=>{let o=document.createElement("link");o.id=j,o.rel="stylesheet",o.href=X;let f=m=>{clearTimeout(M),o.removeEventListener("load",f),o.removeEventListener("error",f),m?.type!=="error"&&o.sheet?s():(o.remove(),p(new Error("Intro stylesheet unavailable")))},M=setTimeout(f,12e3);o.addEventListener("load",f),o.addEventListener("error",f),document.head.appendChild(o)}))}function ce(){let c=typeof navigator.hardwareConcurrency=="number"?navigator.hardwareConcurrency:4,s=window.innerWidth*window.innerHeight,p=Math.min(window.innerWidth,window.innerHeight),o=typeof window.matchMedia=="function"&&window.matchMedia("(hover: hover) and (pointer: fine)").matches;return{cores:c,area:s,smallest:p,finePointer:o,allowParallax:o&&c>2&&s>26e4}}function de(c){let s=Math.round(c.area/13e3);return s=Math.min(s,54),c.smallest<500&&(s=Math.min(s,30)),c.cores<=4&&(s=Math.min(s,40)),c.cores<=2&&(s=Math.min(s,22)),Math.max(12,s)}function ue(){return`
    <div class="intro-bg" aria-hidden="true"></div>
    <div class="intro-glow" aria-hidden="true"></div>
    <canvas class="intro-particles" aria-hidden="true"></canvas>
    <div class="intro-rays" aria-hidden="true"></div>

    <button class="intro-skip" type="button" aria-label="Skip opening animation">
      <span>Skip</span> <span class="intro-skip-arrow" aria-hidden="true">\u2715</span>
    </button>

    <div class="intro-stage" role="img" aria-label="I love you Yomna">
      <div class="intro-parallax" data-depth="tight">
        <div class="intro-heart" aria-hidden="true">
          <span class="intro-ring"></span>
          <span class="intro-ring intro-ring--b"></span>
          <span class="intro-ring intro-ring--c"></span>
          <span class="intro-heart-halo"></span>
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="introHeartGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"  stop-color="#ff9dc0"></stop>
                <stop offset="52%" stop-color="#ff5f96"></stop>
                <stop offset="100%" stop-color="#e03c78"></stop>
              </linearGradient>
            </defs>
            <path class="heart-fill" d="M50 88
              C 22 68, 6 50, 6 32
              C 6 17, 18 8, 31 8
              C 40 8, 47 13, 50 20
              C 53 13, 60 8, 69 8
              C 82 8, 94 17, 94 32
              C 94 50, 78 68, 50 88 Z"></path>
            <path class="heart-stroke" d="M50 88
              C 22 68, 6 50, 6 32
              C 6 17, 18 8, 31 8
              C 40 8, 47 13, 50 20
              C 53 13, 60 8, 69 8
              C 82 8, 94 17, 94 32
              C 94 50, 78 68, 50 88 Z"></path>
          </svg>
        </div>
      </div>

      <div class="intro-copy intro-parallax" data-depth="loose">
        <span class="intro-eyebrow">Our Heart</span>
        <h1 class="intro-title">
          <span class="intro-line intro-line--1">I Love You</span>
          <span class="intro-line intro-line--2"><span class="intro-name">Yomna</span></span>
        </h1>
        <span class="intro-divider" aria-hidden="true"></span>
        <p class="intro-subtitle">Every moment with you feels like home.</p>
      </div>
    </div>

    <div class="intro-vignette" aria-hidden="true"></div>
    <span class="intro-visually-hidden">Opening animation. Activate Skip to continue to the chat.</span>
  `}async function he(c={}){let{shouldContinue:s=()=>!0}=c,p=se();try{console.info("[Our Heart] intro build: "+X)}catch{}if(document.getElementById("romanticIntro"))return Promise.resolve();if(await le(),!s()||document.getElementById("romanticIntro"))return;let o=()=>{};try{return await new Promise(f=>{let M=ce(),m=!1,w=0,S=0,k=[],P=null,C=null,H=null,A=null,F=null,g=0,d=null,l=null,L=null,x=[],E=[],T=1,I=!1,J=0,u={targetX:0,targetY:0,x:0,y:0},Q=90,i=document.createElement("div");i.id="romanticIntro",i.setAttribute("role","dialog"),i.setAttribute("aria-modal","true"),i.setAttribute("aria-label","Opening animation"),i.innerHTML=ue();let Y=document.body.style.overflow,_=document.activeElement;o=()=>{i.remove(),document.body.style.overflow=Y},document.body.style.overflow="hidden",document.body.appendChild(i);let O=[document.getElementById("appMount"),document.getElementById("lockMount")].filter(Boolean),V=O.map(e=>e.inert),W=()=>{O.forEach((e,n)=>{e.inert=V[n]}),_?.isConnected&&typeof _.focus=="function"&&_.focus({preventScroll:!0})};try{O.forEach(e=>{e.inert=!0})}catch{}o=()=>{i.remove(),document.body.style.overflow=Y,W()},d=i.querySelector(".intro-particles"),d&&d.getContext&&(l=d.getContext("2d",{alpha:!0}));function $(){return{x:window.innerWidth/2,y:window.innerHeight*.42}}function z(){if(!d)return;T=Math.min(window.devicePixelRatio||1,2);let e=window.innerWidth,n=window.innerHeight;d.width=Math.max(1,Math.floor(e*T)),d.height=Math.max(1,Math.floor(n*T)),d.style.width=e+"px",d.style.height=n+"px",l&&l.setTransform(T,0,0,T,0,0)}function D(){if(p){x=[];return}let e=de(M),n=window.innerWidth,r=window.innerHeight;x=[];for(let a=0;a<e;a+=1)x.push({x:Math.random()*n,y:Math.random()*r,r:.6+Math.random()*1.7,vx:(Math.random()-.5)*.12,vy:-.06-Math.random()*.24,a:.1+Math.random()*.45,tw:Math.random()*Math.PI*2,tws:.008+Math.random()*.02,drift:Math.random()<.5?-1:1,depth:.35+Math.random()*.65})}function ee(e,n){if(p||!l)return;let r=M.smallest<500?12:18;for(let a=0;a<r&&!(E.length>=Q);a+=1){let y=Math.PI*2*a/r+Math.random()*.3,b=.9+Math.random()*1.9;E.push({x:e,y:n,vx:Math.cos(y)*b,vy:Math.sin(y)*b,r:.8+Math.random()*1.6,life:1,decay:.014+Math.random()*.02})}}function te(){if(p){i.classList.add("is-running"),I=!0;let n=(r,a)=>{k.push(setTimeout(()=>{m||i.classList.add(r)},a))};n("scene-atmosphere",h.atmosphere),n("scene-heart",1200),n("scene-gather",3200),n("scene-eyebrow",4800),n("scene-line1",6200),n("scene-line2",7600),n("scene-final",9200),n("scene-settled",11500),n("scene-exit",14500);return}i.classList.add("is-running"),I=!0;let e=(n,r)=>{k.push(setTimeout(()=>{m||i.classList.add(n)},r))};e("scene-atmosphere",h.atmosphere),e("scene-heart",h.heart),e("scene-gather",h.gather),e("scene-eyebrow",h.revealEyebrow),e("scene-line1",h.revealLine1),e("scene-line2",h.revealLine2),e("scene-final",h.finalMessage),e("scene-settled",h.settle),e("scene-exit",h.exit)}function N(e){if(!I||!l)return;let n=window.innerWidth,r=window.innerHeight,a=$();u.x+=(u.targetX-u.x)*.06,u.y+=(u.targetY-u.y)*.06;let y=i.classList.contains("scene-gather"),b=i.classList.contains("scene-settled");l.clearRect(0,0,n,r);for(let v=0;v<x.length;v+=1){let t=x[v];t.x+=t.vx+t.drift*.15,t.y+=t.vy,t.tw+=t.tws,y&&!b?(t.x+=(a.x-t.x)*.012,t.y+=(a.y-t.y)*.012):b&&(t.x-=(a.x-t.x)*.0016,t.y-=(a.y-t.y)*.0016),t.y<-10&&(t.y=r+10,t.x=Math.random()*n),t.x<-10?t.x=n+10:t.x>n+10&&(t.x=-10);let ie=t.x+u.x*t.depth*16,re=t.y+u.y*t.depth*16,ae=t.a*(.5+.5*Math.sin(t.tw)),oe=t.r*(y&&!b?1.25:1);l.beginPath(),l.arc(ie,re,oe,0,Math.PI*2),l.fillStyle="rgba(255, 214, 232, "+ae.toFixed(3)+")",l.fill()}for(let v=E.length-1;v>=0;v-=1){let t=E[v];if(t.x+=t.vx,t.y+=t.vy,t.vx*=.985,t.vy*=.985,t.life-=t.decay,t.life<=0){E.splice(v,1);continue}l.beginPath(),l.arc(t.x,t.y,t.r*t.life,0,Math.PI*2),l.fillStyle="rgba(255, 190, 216, "+(t.life*.8).toFixed(3)+")",l.fill()}M.allowParallax&&ne(u.x,u.y),w=requestAnimationFrame(N)}let G=Array.prototype.slice.call(i.querySelectorAll(".intro-parallax")).filter(e=>!(typeof e.getAnimations=="function"&&e.getAnimations().length)),U=999,Z=999;function ne(e,n){if(!(Math.abs(e-U)<.002&&Math.abs(n-Z)<.002)){U=e,Z=n;for(let r=0;r<G.length;r+=1){let a=G[r],y=a.dataset.depth==="tight"?9:16;a.style.transform="translate3d("+(e*y).toFixed(2)+"px, "+(n*y).toFixed(2)+"px, 0)"}}}function K(){for(S&&clearTimeout(S),S=0;k.length;)clearTimeout(k.pop())}function R(){if(!m){m=!0,I=!1,w&&cancelAnimationFrame(w),w=0,K(),g&&clearTimeout(g),g=0,P&&L&&L.removeEventListener("click",P),C&&document.removeEventListener("keydown",C),H&&window.removeEventListener("resize",H),A&&window.removeEventListener("pointermove",A),F&&i.removeEventListener("pointerdown",F),document.body.style.overflow=Y;try{W()}catch{}x=[],E=[],d&&(d.width=1,d.height=1),l=null,i.remove(),window.dispatchEvent(new Event("our-heart-intro-closed"))}}o=R,i._teardown=()=>{R(),f()};function B(){if(m)return;i.classList.add("scene-exit","is-leaving"),I=!1,w&&(cancelAnimationFrame(w),w=0),K();let e=()=>{R(),f()};g=setTimeout(e,1200),i.addEventListener("transitionend",n=>{n.target===i&&(g&&clearTimeout(g),g=0,e())},{once:!0})}L=i.querySelector(".intro-skip"),P=e=>{e.preventDefault(),B()},L?.addEventListener("click",P),L?.focus({preventScroll:!0}),C=e=>{(e.key==="Escape"||e.key==="Enter"||e.key==="Spacebar"||e.code==="Space")&&(e.preventDefault(),B())},document.addEventListener("keydown",C);let q=!1;H=()=>{q||m||(q=!0,requestAnimationFrame(()=>{q=!1,!m&&(z(),D())}))},window.addEventListener("resize",H),M.allowParallax&&(A=e=>{let n=e.clientX/window.innerWidth*2-1,r=e.clientY/window.innerHeight*2-1;u.targetX=Math.max(-1,Math.min(1,n)),u.targetY=Math.max(-1,Math.min(1,r))},window.addEventListener("pointermove",A,{passive:!0})),F=e=>{let n=e.target;if(n&&n.closest&&n.closest(".intro-skip")||p)return;let r=e.clientX,a=e.clientY;(typeof r!="number"||typeof a!="number")&&e.touches&&e.touches[0]&&(r=e.touches[0].clientX,a=e.touches[0].clientY),!(typeof r!="number"||typeof a!="number")&&ee(r,a)},i.addEventListener("pointerdown",F,{passive:!0}),z(),D(),J=performance.now?performance.now():Date.now(),x.length&&(w=requestAnimationFrame(N)),requestAnimationFrame(()=>{requestAnimationFrame(()=>{m||(te(),S=setTimeout(B,h.done))})})})}catch(f){throw o(),f}}export{he as showRomanticIntro};
