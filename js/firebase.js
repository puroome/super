// firebase.js — Firestore CRUD

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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

// ─── 기본 정보 ────────────────────────────────────────────────────────────────

/**
 * 기본정보 불러오기
 * @returns {Object} { teachers, rooms, roles, examDays }
 */
async function loadBasic() {
  const snap = await getDoc(doc(db, 'config', 'basic'));
  if (!snap.exists()) return { teachers: [], rooms: [], roles: [], examDays: [] };
  return snap.data();
}

/**
 * 기본정보 저장
 * @param {Object} basic { teachers, rooms, roles, examDays }
 */
async function saveBasic(basic) {
  await setDoc(doc(db, 'config', 'basic'), { ...basic, updatedAt: serverTimestamp() });
}

// ─── 배정감독수정보 ───────────────────────────────────────────────────────────

/**
 * 배정감독수 불러오기
 * @returns {Object} { requirements, roomRequirements }
 *   requirements: [{dayIdx, period, roleIdx, count}]
 *   roomRequirements: [{dayIdx, period, roleIdx, roomName, count}]
 */
async function loadRequirements() {
  const snap = await getDoc(doc(db, 'config', 'requirements'));
  if (!snap.exists()) return { requirements: [], roomRequirements: [] };
  return snap.data();
}

/**
 * 배정감독수 저장
 */
async function saveRequirements(data) {
  await setDoc(doc(db, 'config', 'requirements'), { ...data, updatedAt: serverTimestamp() });
}

// ─── 배정 결과 ────────────────────────────────────────────────────────────────

/**
 * 배정 결과 불러오기
 * @returns {Object} { grid, fixedCells, workload, roleCounts, slots }
 *   grid[i][j]: string ("고사실[보직]" | "0" | "x")
 *   fixedCells[i][j]: true
 */
async function loadAssignment() {
  const snap = await getDoc(doc(db, 'assignments', 'current'));
  if (!snap.exists()) return null;
  return snap.data();
}

/**
 * 배정 결과 저장
 * grid는 2D array를 JSON 직렬화해서 저장
 */
async function saveAssignment({ data, fixedCells, workload, roleCounts, slots }) {
  // Firestore는 중첩 배열을 직접 못 저장하므로 JSON 문자열로
  await setDoc(doc(db, 'assignments', 'current'), {
    grid: JSON.stringify(data),
    fixedCells: JSON.stringify(fixedCells),
    workload: JSON.stringify(workload),
    roleCounts: JSON.stringify(roleCounts),
    slots: JSON.stringify(slots),
    updatedAt: serverTimestamp(),
  });
}

/**
 * 고정셀만 업데이트 (배정 결과는 유지)
 */
async function updateFixedCells(fixedCells) {
  await updateDoc(doc(db, 'assignments', 'current'), {
    fixedCells: JSON.stringify(fixedCells),
    updatedAt: serverTimestamp(),
  });
}

/**
 * loadAssignment 결과를 파싱해서 실제 배열로 변환
 */
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

export {
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
};
