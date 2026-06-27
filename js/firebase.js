// firebase.js — Firestore CRUD + Google 로그인 + 계정별 데이터 분리

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, addDoc, getDocs, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { emailInList } from './allowlist.js';

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
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── 로그인 / 권한 ─────────────────────────────────────────────────────────────
// 로그인한 사용자의 uid. 모든 데이터 경로(users/{uid}/...)의 뿌리. 로그인 전에는 null.
let currentUid = null;
let currentUser = null;

// meta/allowlist 문서의 emails 배열에 있는 이메일만 통과시킨다.
// ponytail: 명단을 매 로그인마다 1회 읽음(getDoc). 사용자 4명 규모라 비용 무시 가능.
//           수백 명 규모로 커지면 메모리 캐시 + 만료 정책으로 업그레이드.
async function isEmailAllowed(email) {
  const snap = await getDoc(doc(db, 'meta', 'allowlist'));
  if (!snap.exists()) return false;
  return emailInList(email, snap.data().emails ?? []);
}

// 우리가 거부 처리하며 일으킨 강제 로그아웃 이벤트를 무시하기 위한 플래그.
let denying = false;

// 로그인 상태가 바뀔 때마다 callback 호출.
// callback({ status: 'allowed' | 'denied' | 'signed-out', email, name })
function watchAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (denying) return; // 강제 로그아웃이 만든 null 이벤트는 건너뜀
    if (!user) {
      currentUid = null; currentUser = null;
      callback({ status: 'signed-out' });
      return;
    }
    let allowed = false;
    try {
      allowed = await isEmailAllowed(user.email);
    } catch (e) {
      console.error('허용 명단 확인 실패:', e); // 명단을 못 읽으면 안전하게 거부
    }
    if (!allowed) {
      currentUid = null; currentUser = null;
      denying = true;
      callback({ status: 'denied', email: user.email });
      await signOut(auth);
      denying = false;
      return;
    }
    currentUid = user.uid;
    currentUser = user;
    callback({ status: 'allowed', email: user.email, name: user.displayName });
  });
}

async function signIn() {
  await signInWithPopup(auth, provider); // 결과는 watchAuth가 처리
}

async function signOutNow() {
  await signOut(auth);
}

// ─── 경로 헬퍼 ─────────────────────────────────────────────────────────────────
// 모든 데이터는 users/{uid} 하위에 저장 → 계정별 완전 분리.
function requireUid() {
  if (!currentUid) throw new Error('로그인이 필요합니다.');
  return currentUid;
}
function uDoc(...segs) { return doc(db, 'users', requireUid(), ...segs); }
function uCol(...segs) { return collection(db, 'users', requireUid(), ...segs); }

// ─── 기본정보 / 배정설정 / 배정결과 ─────────────────────────────────────────────

const DEFAULT_ROLES = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50, active: true }];

async function loadBasic() {
  const snap = await getDoc(uDoc('config', 'basic'));
  if (!snap.exists()) return { teachers: [], rooms: [], roomMeta: [], roles: DEFAULT_ROLES, examDays: [] };
  const data = snap.data();
  // ponytail: roles가 빈 배열로 저장된 경우 기본값으로 복구
  if (!data.roles?.length) data.roles = DEFAULT_ROLES;
  return data;
}
async function saveBasic(basic) {
  await setDoc(uDoc('config', 'basic'), { ...basic, updatedAt: serverTimestamp() });
}

async function loadRequirements() {
  const snap = await getDoc(uDoc('config', 'requirements'));
  if (!snap.exists()) return { requirements: [], roomRequirements: [] };
  return snap.data();
}

async function saveRequirements(data) {
  await setDoc(uDoc('config', 'requirements'), { ...data, updatedAt: serverTimestamp() });
}

async function loadAssignment() {
  const snap = await getDoc(uDoc('assignments', 'current'));
  if (!snap.exists()) return null;
  return snap.data();
}

async function saveAssignment({ data, fixedCells, workload, roleCounts, slots }) {
  await setDoc(uDoc('assignments', 'current'), {
    grid: JSON.stringify(data),
    fixedCells: JSON.stringify(fixedCells),
    workload: JSON.stringify(workload),
    roleCounts: JSON.stringify(roleCounts),
    slots: JSON.stringify(slots),
    updatedAt: serverTimestamp(),
  });
}

async function updateFixedCells(fixedCells) {
  await updateDoc(uDoc('assignments', 'current'), {
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
    deleteDoc(uDoc('config', 'basic')),
    deleteDoc(uDoc('config', 'requirements')),
    deleteDoc(uDoc('assignments', 'current')),
  ]);
}

// ─── 이름 저장본 ────────────────────────────────────────────────────────────────

async function saveNamed(name, snapshot) {
  const ref = await addDoc(uCol('saves'), {
    name,
    payload: JSON.stringify(snapshot),
    savedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateNamed(id, name, snapshot) {
  await setDoc(uDoc('saves', id), {
    name,
    payload: JSON.stringify(snapshot),
    savedAt: serverTimestamp(),
  }, { merge: true });
}

async function listSaves() {
  const snap = await getDocs(query(uCol('saves'), orderBy('savedAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, name: d.data().name, savedAt: d.data().savedAt }));
}

async function loadNamed(id) {
  const snap = await getDoc(uDoc('saves', id));
  if (!snap.exists()) return null;
  return JSON.parse(snap.data().payload);
}

async function deleteNamed(id) {
  await deleteDoc(uDoc('saves', id));
}

export {
  watchAuth, signIn, signOutNow,
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
  clearCurrentDocs,
  saveNamed, updateNamed, listSaves, loadNamed, deleteNamed,
};
