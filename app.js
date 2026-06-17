import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
getFirestore,
doc,
setDoc,
onSnapshot
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

window.updateStatus = async function(person,status){

await setDoc(doc(db,"status",person),{
status:status,
time:new Date().toLocaleString()
});

};

window.sendMessage = async function(person){

let message=document.getElementById(person+"Msg").value;

await setDoc(doc(db,"messages",person),{
message:message,
time:new Date().toLocaleString()
});

};

onSnapshot(doc(db,"status","mohamed"),(docSnap)=>{

if(docSnap.exists()){
document.getElementById("mohamedStatus").innerHTML=
docSnap.data().status+"<br>"+docSnap.data().time;
}

});

onSnapshot(doc(db,"status","Yomna"),(docSnap)=>{

if(docSnap.exists()){
document.getElementById("YomnaStatus").innerHTML=
docSnap.data().status+"<br>"+docSnap.data().time;
}

});

onSnapshot(doc(db,"messages","mohamed"),(docSnap)=>{

if(docSnap.exists()){
document.getElementById("mohamedMessage").innerHTML=
docSnap.data().message;
}

});

onSnapshot(doc(db,"messages","Yomna"),(docSnap)=>{

if(docSnap.exists()){
document.getElementById("YomnaMessage").innerHTML=
docSnap.data().message;
}

});