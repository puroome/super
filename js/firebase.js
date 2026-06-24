// firebase.js — Firestore CRUD

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, addDoc, getDocs, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBIX_j0nS3kldLegBmr_f0fG_hB5vTz6Xw',
  authDomain: 'timetable-3da68.firebaseapp.com',
  projectId: 'timetable-3da68',
  storageBucket: 'timetable-3da68.firebasestorage.app',
  messagingSenderId: '867380002856',
  appId: '1:867380002856:web:15396602f89e6198caf51d',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function loadBasic() {
  const snap = await getDoc(doc(db, 'config', 'basic'));
  if (!snap.exists()) return { teachers: [], rooms: [], roles: [], examDays: [] };
  return snap.data();
}

async function saveBasic(basic) {
  await setDoc(doc(db, 'config', 'basic'), { ...basic, updatedAt: serverTimestamp() });
}

async function loadRequirements() {
  const snap = await getDoc(doc(db, 'config', 'requirements'));
  if (!snap.exists()) return { requirements: [], roomRequirements: [] };
  return snap.data();
}

async function saveRequirements(data) {
  await setDoc(doc(db, 'config', 'requirements'), { ...data, updatedAt: serverTimestamp() });
}

async function loadAssignment() {
  const snap = await getDoc(doc(db, 'assignments', 'current'));
  if (!snap.exists()) return null;
  return snap.data();
}

async function saveAssignment({ data, fixedCells, workload, roleCounts, slots }) {
  await setDoc(doc(db, 'assignments', 'current'), {
    grid: JSON.stringify(data),
    fixedCells: JSON.stringify(fixedCells),
    workload: JSON.stringify(workload),
    roleCounts: JSON.stringify(roleCounts),
    slots: JSON.stringify(slots),
    updatedAt: serverTimestamp(),
  });
}

async function updateFixedCells(fixedCells) {
  await updateDoc(doc(db, 'assignments', 'current'), {
    fixedCells: JSON.stringify(fixedCells),
    updatedAt: serverTimestamp(),
  });
}

function parseAssignment(raw) {
  if (!raw) return null;
  return {
    data: JSON.parse(raw.grid),
    fixedCells: JSON.parse(raw.fixedCells),
    workload: JSON.parse(raw.workload),
    roleCounts: JSON.parse(raw.roleCounts),
    slots: JSON.parse(raw.slots),
  };
}

async function clearCurrentDocs() {
  await Promise.all([
    deleteDoc(doc(db, 'config', 'basic')),
    deleteDoc(doc(db, 'config', 'requirements')),
    deleteDoc(doc(db, 'assignments', 'current')),
  ]);
}

async function saveNamed(name, snapshot) {
  const ref = await addDoc(collection(db, 'saves'), {
    name,
    payload: JSON.stringify(snapshot),
    savedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateNamed(id, name, snapshot) {
  await setDoc(doc(db, 'saves', id), {
    name,
    payload: JSON.stringify(snapshot),
    savedAt: serverTimestamp(),
  }, { merge: true });
}

async function listSaves() {
  const snap = await getDocs(query(collection(db, 'saves'), orderBy('savedAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, name: d.data().name, savedAt: d.data().savedAt }));
}

async function loadNamed(id) {
  const snap = await getDoc(doc(db, 'saves', id));
  if (!snap.exists()) return null;
  return JSON.parse(snap.data().payload);
}

async function deleteNamed(id) {
  await deleteDoc(doc(db, 'saves', id));
}

export {
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
  clearCurrentDocs,
  saveNamed, updateNamed, listSaves, loadNamed, deleteNamed,
};
