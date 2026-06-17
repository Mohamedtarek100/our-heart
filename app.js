import { initializeApp }
from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  updateDoc
}
from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD9XAlpeDn4UFp-0taUmCvUm86XkPTNboM",
  authDomain: "our-status-a9535.firebaseapp.com",
  projectId: "our-status-a9535",
  storageBucket: "our-status-a9535.firebasestorage.app",
  messagingSenderId: "402776687762",
  appId: "1:402776687762:web:556c3e1449e3fc9e58924b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
window.updateOnlineStatus = async function(){
  

await setDoc(
doc(db,"online",currentUser),
{
lastSeen:Date.now()
}
);

}
setInterval(() => {

  updateOnlineStatus();

}, 10000);

window.typing = async function(){

await setDoc(
doc(db,"typing",currentUser),
{
typing:true
}
);

setTimeout(async ()=>{

await setDoc(
doc(db,"typing",currentUser),
{
typing:false
}
);

},2000);

}


// اختيار المستخدم
let currentUser = localStorage.getItem("currentUser");

const mainApp = document.getElementById("mainApp");
const userSelector = document.getElementById("userSelector");

if (currentUser === "Mohamed" || currentUser === "Yomna") {

  mainApp.style.display = "block";
  userSelector.style.display = "none";
  updateOnlineStatus();

}

document.getElementById("mohamedBtn").onclick = () => {

  currentUser = "Mohamed";

  localStorage.setItem(
    "currentUser",
    currentUser
  );

  location.reload();

};

document.getElementById("yomnaBtn").onclick = () => {

  currentUser = "Yomna";

  localStorage.setItem(
    "currentUser",
    currentUser
  );

  location.reload();

};


// تحديث الحالة
window.updateStatus = async function (person, status) {

  await setDoc(
    doc(db, "status", person),
    {
      status: status,
      time: new Date().toLocaleString()
    }
  );

};


// إرسال رسالة
window.sendMessage = async function () {

  let text = document
    .getElementById("messageInput")
    .value
    .trim();

  if (text === "") return;

await addDoc(
  collection(db, "chat"),
  {
    sender: currentUser,
    text: text,
    time: Date.now(),
    status: "delivered",
    seen: false,
    reaction: ""
  }
);

  document.getElementById("messageInput").value = "";

};


// حالة محمد
onSnapshot(
  doc(db, "status", "mohamed"),
  (docSnap) => {

    if (docSnap.exists()) {

      document.getElementById("mohamedStatus").innerHTML =
        docSnap.data().status +
        "<br>" +
        docSnap.data().time;

    }

  }
);


// حالة يمنى
onSnapshot(
  doc(db, "status", "yomna"),
  (docSnap) => {

    if (docSnap.exists()) {

      document.getElementById("yomnaStatus").innerHTML =
        docSnap.data().status +
        "<br>" +
        docSnap.data().time;

    }

  }
);


// الشات
const q = query(
  collection(db, "chat"),
  orderBy("time")
);

onSnapshot(q, (snapshot) => {

  let html = "";

  snapshot.forEach((docSnap) => {

    let msg = docSnap.data();
    let messageId = docSnap.id;
    if (
msg.sender !== currentUser &&
!msg.seen
){

updateDoc(
docSnap.ref,
{
seen:true
}
);

}

    if (
      Date.now() - msg.time <
      48 * 60 * 60 * 1000
    ) {

      let checkMark =
msg.seen
?
"✓✓ Seen"
:
"✓ Delivered";

if (msg.seen) {

  checkMark = "✓✓ Seen";

}
let cls =
  msg.sender === currentUser
    ? "message me"
    : "message her";
html += `
<div class="message ${cls}">

  <div>
    ${msg.text}
  </div>

  <small>

    ${msg.sender}

    -

    ${new Date(msg.time).toLocaleTimeString()}

    <br>

    ${checkMark}

  </small>

  <div class="reaction">
    ${msg.reaction || ""}
  </div>

  <div class="reactionButtons">

    <button onclick="reactMessage('${messageId}','❤️')">
      ❤️
    </button>

    <button onclick="reactMessage('${messageId}','😂')">
      😂
    </button>

    <button onclick="reactMessage('${messageId}','🫂')">
      🫂
    </button>

    <button onclick="reactMessage('${messageId}','🥺')">
      🥺
    </button>

  </div>

</div>
`;

    }

  });

  document.getElementById("chatBox").innerHTML = html;

  document.getElementById("chatBox").scrollTop =
    document.getElementById("chatBox").scrollHeight;

});
window.reactMessage = async function(messageId, emoji){

  await updateDoc(
    doc(db, "chat", messageId),
    {
      reaction: emoji
    }
  );

}
window.changeUser = function(){

localStorage.removeItem("currentUser");

location.reload();

}
let otherUser =
currentUser === "Mohamed"
?
"Yomna"
:
"Mohamed";


onSnapshot(

doc(
db,
"typing",
otherUser
),

(docSnap)=>{

if(

docSnap.exists()

&&

docSnap.data().typing

){

document.getElementById(

"typingStatus"

).innerHTML =

"✍️ " +

otherUser +

" is typing...";

}

else{

document.getElementById(

"typingStatus"

).innerHTML = "";

}

}

);
onSnapshot(

doc(
db,
"online",
otherUser
),

(docSnap)=>{

if(docSnap.exists()){

let data = docSnap.data();

if (Date.now() - data.lastSeen < 30000) {

  document.getElementById(
    "onlineStatus"
  ).innerHTML = "🟢 Online";

}
else {

document.getElementById(
"onlineStatus"
).innerHTML =

"Last seen " +

new Date(
data.lastSeen
).toLocaleTimeString();

}

}

}

);
window.addEventListener(

"beforeunload",

async ()=>{

await setDoc(

doc(
db,
"online",
currentUser
),

{

online:false,

lastSeen:Date.now()

}

);

}

);