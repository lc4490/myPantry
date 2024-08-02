// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {getFirestore} from 'firebase/firestore'
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD3j3HKuCY0x74ygorWa-7xLiCiXB4LKfc",
  authDomain: "jspantryapp.firebaseapp.com",
  projectId: "jspantryapp",
  storageBucket: "jspantryapp.appspot.com",
  messagingSenderId: "341090631818",
  appId: "1:341090631818:web:69717c8fdef1961fe76d73"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app)
export{app, firestore}