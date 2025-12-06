/* scripts.js - BridgeUp MVP logic
   - Contains simple demo data and Firebase hooks (replace config to enable).
   - Navigation uses onclick -> go('page.html')
*/

/* ---------- NAV ---------- */
function go(url){ window.location.href = url; }

/* ---------- Firebase (optional) ----------
  Replace the config below with your Firebase project config.
  If you don't paste a config, the app will run in demo mode using local demo data.
*/
const FIREBASE_CONFIG = {
  // paste your config here OR leave {} for demo mode
  apiKey: "",
  authDomain: "",
  projectId: "",
  // ...
};

const useFirebase = !!FIREBASE_CONFIG.apiKey;

// ---- Demo data fallback (works without Firebase) ----
const demoUser = { fullname: "Demo Student", email: "demo@bridgeup.com", level: "Level 1" };
const demoMentors = [
  {name:"Arun Kumar", domain:"Web", tier:"Tier 1", college:"IIT Madras", contact:"arun@iitm.edu"},
  {name:"Priya S", domain:"AI/ML", tier:"Tier 1", college:"NIT Trichy", contact:"priya@nitt.edu"},
  {name:"Ramesh", domain:"Embedded/IoT", tier:"Tier 2", college:"Anna Univ", contact:"ramesh@anna.edu"}
];
const demoJobs = [
  {title:"Frontend Intern", source:"Internshala", trusted:true, apply:"https://internshala.com/example"},
  {title:"ML Research Intern", source:"CompanyPortalX", trusted:false, apply:"#"}
];
let demoTeamPosts = [
  {id:1, domain:"Web", role:"Frontend", desc:"Need 1 frontend for hackathon", postedBy:"Demo Student"}
];

/* ---------- Basic UI helpers ---------- */
function showAlert(el, msg, type='info') {
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  setTimeout(()=> el.innerHTML = '', 3500);
}

/* ---------- AUTH (demo + firebase) ---------- */
async function loginDemo(email, pass) {
  // demo just accepts any non-empty
  if(!email || !pass) throw new Error("Email & password required (demo).");
  return {...demoUser, email};
}

async function signupDemo(fullname, email, pass) {
  if(!fullname || !email || !pass) throw new Error("All signup fields required (demo).");
  return {...demoUser, fullname, email};
}

/* Wire login/signup buttons */
document.addEventListener('DOMContentLoaded', ()=>{
  const lb = document.getElementById('loginBtn');
  const sb = document.getElementById('signupBtn');
  if(lb) lb.onclick = async ()=>{
    const email = document.getElementById('email').value.trim();
    const pass = document.getElementById('password').value.trim();
    const alertEl = document.getElementById('authAlert');
    try {
      let user;
      if(useFirebase) {
        // TODO: firebase auth signInWithEmailAndPassword (not included to keep code simple)
        user = await loginDemo(email, pass);
      } else user = await loginDemo(email, pass);
      localStorage.setItem('bridgeup_user', JSON.stringify(user));
      window.location.href = 'dashboard.html';
    } catch(e){
      showAlert(alertEl, e.message, 'danger');
    }
  };
  if(sb) sb.onclick = async ()=>{
    const fullname = document.getElementById('fullname').value.trim();
    const email = document.getElementById('email').value.trim();
    const pass = document.getElementById('password').value.trim();
    const alertEl = document.getElementById('authAlert');
    try {
      let user;
      if(useFirebase) {
        user = await signupDemo(fullname, email, pass);
      } else user = await signupDemo(fullname, email, pass);
      localStorage.setItem('bridgeup_user', JSON.stringify(user));
      window.location.href = 'dashboard.html';
    } catch(e){
      showAlert(alertEl, e.message, 'danger');
    }
  };
});

/* ---------- Dashboard init ---------- */
function initDashboard(){
  const raw = localStorage.getItem('bridgeup_user');
  const user = raw ? JSON.parse(raw) : demoUser;
  document.getElementById('welcomeHeading').textContent = `Welcome, ${user.fullname || user.email.split('@')[0]}`;
  document.getElementById('userLevel').textContent = user.level || '—';
  document.getElementById('levelDesc').textContent = user.level ? `You are ${user.level}` : 'Complete the quiz to get a level';
  // mentors
  const mEl = document.getElementById('mentorList');
  mEl.innerHTML = '';
  const mentors = demoMentors;
  mentors.slice(0,3).forEach(m => {
    const li = document.createElement('li'); li.innerHTML = `<strong>${m.name}</strong> — ${m.domain} (${m.college})`; mEl.appendChild(li);
  });
  // jobs
  const jEl = document.getElementById('jobList');
  jEl.innerHTML = '';
  demoJobs.forEach(j => {
    const li = document.createElement('li'); li.innerHTML = `${j.title} <small class="text-muted">via ${j.source}${j.trusted?'' : ' ⚠️'}</small>`; jEl.appendChild(li);
  });
}

/* Logout */
function logout(){ localStorage.removeItem('bridgeup_user'); go('index.html'); }

/* ---------- Quiz (skill level) ---------- */
const QUIZ_QS = [
  {q:"I am comfortable writing loops and arrays", opts:["No","Somewhat","Yes"], w:[0,1,2]},
  {q:"I can solve easy DSA problems (arrays, hash)", opts:["No","Somewhat","Yes"], w:[0,1,2]},
  {q:"I know basic HTML/CSS", opts:["No","Somewhat","Yes"], w:[0,1,2]},
  {q:"I can explain functions and OOP", opts:["No","Somewhat","Yes"], w:[0,1,2]},
  {q:"I am comfortable reading math-heavy papers", opts:["No","Somewhat","Yes"], w:[0,1,2]}
];

function createQuizUI(){
  const cont = document.getElementById('questionsContainer');
  if(!cont) return;
  cont.innerHTML = '';
  QUIZ_QS.forEach((q,i)=>{
    const div = document.createElement('div'); div.className='mb-3';
    div.innerHTML = `<label class="form-label">${i+1}. ${q.q}</label>
      <select id="q${i}" class="form-select">
        ${q.opts.map((o,idx)=>`<option value="${q.w[idx]}">${o}</option>`).join('')}
      </select>`;
    cont.appendChild(div);
  });
  // coding confidence
  cont.insertAdjacentHTML('beforeend', `<div class="mb-3"><label class="form-label">Coding confidence (1-5)</label><input id="conf" type="range" min="1" max="5" value="2" class="form-range"></div>`);
}

function submitQuiz(){
  let score = 0;
  QUIZ_QS.forEach((q,i)=>{ score += parseInt(document.getElementById('q'+i).value,10); });
  score += parseInt(document.getElementById('conf').value,10); // 1-5
  let level = 'Level 1'; if(score >= 10) level='Level 3'; else if(score >= 7) level='Level 2';
  const res = document.getElementById('quizResult');
  res.innerHTML = `<div class="alert alert-success">You scored ${score}. Assigned <strong>${level}</strong>. Saved to profile (demo).</div>`;
  // Save to local demo profile
  const raw = localStorage.getItem('bridgeup_user'); const u = raw?JSON.parse(raw):demoUser; u.level = level; localStorage.setItem('bridgeup_user', JSON.stringify(u));
}

/* ---------- Mentors render ---------- */
function renderMentors(){
  const cont = document.getElementById('mentorsContainer');
  const domain = document.getElementById('filterDomain') ? document.getElementById('filterDomain').value : '';
  const tier = document.getElementById('filterTier') ? document.getElementById('filterTier').value : '';
  cont.innerHTML = '';
  const list = demoMentors.filter(m => (domain? m.domain===domain:true) && (tier? m.tier===tier:true));
  if(!list.length) return cont.innerHTML = '<div class="col-12"><div class="alert alert-info">No mentors found for filters.</div></div>';
  list.forEach(m=>{
    const col = document.createElement('div'); col.className='col-md-6';
    col.innerHTML = `<div class="card p-3"><h6>${m.name} <small class="text-muted">(${m.tier})</small></h6><p>${m.domain} • ${m.college}</p><div class="d-flex gap-2"><button class="btn btn-sm btn-outline-primary" onclick='startChat("${m.name}")'>Chat</button><a href="mailto:${m.contact}" class="btn btn-sm btn-primary">Email</a></div></div>`;
    cont.appendChild(col);
  });
}

function startChat(name){
  alert(`Chat demo: This opens a chat with ${name}. For hackathon, show chat UI or Firebase realtime messages.`);
}

/* ---------- Team posts (teammate finder) ---------- */
function loadTeamPosts(){
  const cont = document.getElementById('teamPosts');
  cont.innerHTML = '';
  demoTeamPosts.forEach(p=>{
    const div = document.createElement('div'); div.className = 'col-md-6';
    div.innerHTML = `<div class="card p-3"><h6>${p.domain} — ${p.role}</h6><p>${p.desc}</p><small>Posted by ${p.postedBy}</small><div class="mt-2"><button class="btn btn-sm btn-primary" onclick='joinTeam(${p.id})'>Request Join</button></div></div>`;
    cont.appendChild(div);
  });
}

function postTeam(){
  const domain = document.getElementById('tmDomain').value || 'General';
  const role = document.getElementById('tmRole').value || 'Any';
  const id = Date.now();
  const postedBy = (JSON.parse(localStorage.getItem('bridgeup_user')) || demoUser).fullname || 'Anon';
  demoTeamPosts.push({id, domain, role, desc:`Need ${role} for ${domain}`, postedBy});
  loadTeamPosts();
}

function joinTeam(id){
  alert('Request sent to join. For demo, show modal or send message to poster.');
}

/* ---------- Jobs render + fake-site detect ---------- */
function renderJobs(){
  const cont = document.getElementById('jobsContainer');
  const jobs = demoJobs;
  cont.innerHTML = jobs.map(j => {
    const flag = j.trusted ? '' : '<span class="badge bg-warning text-dark">Check</span>';
    return `<div class="col-md-6"><div class="card p-3"><h6>${j.title} ${flag}</h6><p class="mb-1"><small>${j.source}</small></p><a class="btn btn-sm btn-primary" href="${j.apply}" target="_blank">Apply</a></div></div>`;
  }).join('');
}

/* ---------- Gaming quick match ---------- */
function quickMatch(){
  const interests = ['DSA','Web','AI','IoT'];
  const pick = interests[Math.floor(Math.random()*interests.length)];
  const el = document.getElementById('gameMatchResult');
  el.innerHTML = `<div class="alert alert-info">Matched with players interested in <strong>${pick}</strong>. (Demo)</div>`;
}

function joinRoom(){
  const code = document.getElementById('roomCode').value.trim();
  const el = document.getElementById('gameMatchResult');
  if(!code) return showAlert(el, 'Enter a room code', 'warning');
  el.innerHTML = `<div class="alert alert-success">Joined room ${code}. People in this room: DemoUser1, DemoUser2</div>`;
}

/* ---------- Domain suggestion ---------- */
function suggestDomain(){
  const pref = document.getElementById('pref').value;
  const math = document.getElementById('math').value;
  let suggestion = 'Web Development';
  if(pref === 'logic' && math !== 'low') suggestion = 'Competitive Programming / DSA';
  if(pref === 'data') suggestion = (math === 'high') ? 'AI / ML' : 'Data Analytics';
  if(pref === 'design') suggestion = 'UI / UX / Frontend';
  if(pref === 'hardware') suggestion = 'Embedded Systems / IoT';
  document.getElementById('domainSuggestion').innerHTML = `<div class="alert alert-primary">Suggestion: <strong>${suggestion}</strong></div>`;
}

/* ---------- Small helpers ---------- */
function initDemoContent(){
  // seeded-demo: save demo user if none
  if(!localStorage.getItem('bridgeup_user')) localStorage.setItem('bridgeup_user', JSON.stringify(demoUser));
  // if on index, nothing else
}

/* auto-run small init */
if(document.readyState !== 'loading') initDemoContent(); else document.addEventListener('DOMContentLoaded', initDemoContent);
