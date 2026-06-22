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

/**
 * 현재 작업본(자동 이어쓰기용 config/basic, config/requirements, assignments/current)을 모두 비움.
 * ponytail: "초기화" 버튼에서 호출 — 안 비우면 새로고침 시 loadAll()이 이 문서들을 다시 읽어와서
 *   화면을 지워도 자료가 되살아나는 것처럼 보인다. 존재하지 않는 문서를 delete해도 에러는 안 남.
 */
async function clearCurrentDocs() {
  await Promise.all([
    deleteDoc(doc(db, 'config', 'basic')),
    deleteDoc(doc(db, 'config', 'requirements')),
    deleteDoc(doc(db, 'assignments', 'current')),
  ]);
}

// ─── 이름 지정 저장(저장함) ───────────────────────────────────────────────────

/**
 * 완성된 작업본을 이름을 붙여 별도로 저장 (여러 건 누적 가능)
 * @param {string} name
 * @param {Object} snapshot { teachers, rooms, roles, examDays, requirements, roomRequirements, assignment }
 */
async function saveNamed(name, snapshot) {
  await addDoc(collection(db, 'saves'), {
    name,
    payload: JSON.stringify(snapshot),
    savedAt: serverTimestamp(),
  });
}

/**
 * 저장함 목록 (최신순)
 * @returns {Array<{id, name, savedAt}>}
 */
async function listSaves() {
  const snap = await getDocs(query(collection(db, 'saves'), orderBy('savedAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, name: d.data().name, savedAt: d.data().savedAt }));
}

/**
 * 저장함에서 하나 불러오기
 * @returns {Object|null} snapshot
 */
async function loadNamed(id) {
  const snap = await getDoc(doc(db, 'saves', id));
  if (!snap.exists()) return null;
  return JSON.parse(snap.data().payload);
}

/**
 * 저장함에서 하나 삭제
 */
async function deleteNamed(id) {
  await deleteDoc(doc(db, 'saves', id));
}

export {
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
  clearCurrentDocs,
  saveNamed, listSaves, loadNamed, deleteNamed,
};
