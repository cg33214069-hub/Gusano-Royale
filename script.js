// ==========================================
// 1. CONFIGURACIÓN DEL JUEGO (MODO EXPRÉS)
// ==========================================
const WORLD_SIZE = 4000;
const INITIAL_BOTS = 99;
const PREPARATION_TIME = 10; 
const COMBAT_TIME = 60;      

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mCtx = minimapCanvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  minimapCanvas.width = 120;
  minimapCanvas.height = 120;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let selectedEntryFee = parseInt(localStorage.getItem('selected_entry')) || 100;
let selectedSkin = localStorage.getItem('selected_skin') || 've';
let gameActive = true;
let currentPhase = 'PREPARATION';
let timeLeft = PREPARATION_TIME;
let timerInterval = null;
let safeSpawnFrames = 0; 

const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
let isBoosting = false;

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
  }
}, { passive: true });

const boostBtn = document.getElementById('boost-btn');
if (boostBtn) {
  boostBtn.addEventListener('mousedown', () => isBoosting = true);
  boostBtn.addEventListener('mouseup', () => isBoosting = false);
  boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isBoosting = true; });
  boostBtn.addEventListener('touchend', () => isBoosting = false);
}

window.addEventListener('keydown', (e) => { if (e.code === 'Space') isBoosting = true; });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') isBoosting = false; });

let foodOrbs = [];

function spawnDeathLoot(x, y, value) {
  foodOrbs.push({
    x: x, y: y, ves: value,
    radius: Math.max(4, Math.min(14, Math.sqrt(value) * 1.5)),
    color: value > 500 ? '#4ade80' : (value > 100 ? '#38bdf8' : '#fef08a')
  });
}

// ==========================================
// 2. CLASE WORM
// ==========================================
class Worm {
  constructor(id, name, x, y, isPlayer = false, color = '#38bdf8') {
    this.id = id;
    this.name = name;
    this.x = x;
    this.y = y;
    this.isPlayer = isPlayer;
    this.skinId = isPlayer ? selectedSkin : 'bot';
    this.color = color;
    this.ves = selectedEntryFee;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = 3.5;
    this.radius = 12;
    this.body = [];
    this.length = 25;
    this.alive = true;
    this.kills = 0;
    this.aiTargetAngle = this.angle;
    this.aiChangeTimer = 0;

    for (let i = 0; i < this.length; i++) {
      this.body.push({ x: this.x, y: this.y });
    }
  }

  update() {
    if (!this.alive) return;

    this.radius = 10 + Math.min(25, Math.sqrt(this.ves) * 0.3);
    this.length = Math.floor(20 + this.ves / (selectedEntryFee / 25));

    let currentSpeed = this.speed;

    if (this.isPlayer && isBoosting && this.ves > (selectedEntryFee * 0.1)) {
      currentSpeed = 6.5;
      this.ves -= (selectedEntryFee * 0.0005);
    } else if (!this.isPlayer && Math.random() < 0.02 && this.ves > selectedEntryFee * 2) {
      currentSpeed = 5.5;
    }

    if (this.isPlayer) {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const targetAngle = Math.atan2(mouse.y - centerY, mouse.x - centerX);
      let diff = targetAngle - this.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.angle += diff * 0.12;
    } else {
      this.aiChangeTimer--;
      if (this.aiChangeTimer <= 0) {
        this.aiTargetAngle = this.angle + (Math.random() - 0.5) * 2;
        this.aiChangeTimer = Math.floor(Math.random() * 50) + 20;
      }
      
      const margin = 300;
      if (this.x < margin) this.aiTargetAngle = 0.2;
      if (this.x > WORLD_SIZE - margin) this.aiTargetAngle = Math.PI - 0.2;
      if (this.y < margin) this.aiTargetAngle = Math.PI / 2 + 0.2;
      if (this.y > WORLD_SIZE - margin) this.aiTargetAngle = -Math.PI / 2 - 0.2;

      let diff = this.aiTargetAngle - this.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.angle += diff * 0.08;
    }

    this.x += Math.cos(this.angle) * currentSpeed;
    this.y += Math.sin(this.angle) * currentSpeed;

    this.x = Math.max(50, Math.min(WORLD_SIZE - 50, this.x));
    this.y = Math.max(50, Math.min(WORLD_SIZE - 50, this.y));

    this.body.unshift({ x: this.x, y: this.y });
    while (this.body.length > this.length) {
      this.body.pop();
    }

    for (let i = foodOrbs.length - 1; i >= 0; i--) {
      const orb = foodOrbs[i];
      const dist = Math.hypot(this.x - orb.x, this.y - orb.y);
      if (dist < this.radius + orb.radius + 10) {
        this.ves += orb.ves;
        foodOrbs.splice(i, 1);
      }
    }
  }

  draw(camera) {
    if (!this.alive) return;

    for (let i = this.body.length - 1; i >= 0; i--) {
      const seg = this.body[i];
      const screenX = seg.x - camera.x;
      const screenY = seg.y - camera.y;

      if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) continue;

      ctx.beginPath();
      const segRadius = Math.max(3, this.radius * (1 - (i / this.body.length) * 0.3));
      ctx.arc(screenX, screenY, segRadius, 0, Math.PI * 2);

      // Renderizado de skins personalizadas para el jugador
      if (this.isPlayer) {
        if (this.skinId === 've') {
          // Bandera de Venezuela (Franjas tricolores)
          if (i % 3 === 0) ctx.fillStyle = '#ffcc00'; // Amarillo
          else if (i % 3 === 1) ctx.fillStyle = '#00247d'; // Azul
          else ctx.fillStyle = '#cf142b'; // Rojo
        } else if (this.skinId === 'neon_cyber') {
          ctx.fillStyle = i % 2 === 0 ? '#00f2fe' : '#4facfe';
        } else if (this.skinId === 'fire') {
          ctx.fillStyle = i % 2 === 0 ? '#ff0844' : '#ffb199';
        } else if (this.skinId === 'gold') {
          ctx.fillStyle = i % 2 === 0 ? '#bf953f' : '#fcf6ba';
        } else if (this.skinId === 'rainbow') {
          const hue = (i * 15) % 360;
          ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        } else {
          ctx.fillStyle = this.color;
        }
      } else {
        ctx.fillStyle = this.color;
      }

      ctx.fill();
    }

    const headX = this.x - camera.x;
    const headY = this.y - camera.y;

    if (headX >= -50 && headX <= canvas.width + 50 && headY >= -50 && headY <= canvas.height + 50) {
      ctx.fillStyle = '#fff';
      const eyeOffset = this.radius * 0.5;
      ctx.beginPath(); ctx.arc(headX + Math.cos(this.angle + 0.5) * eyeOffset, headY + Math.sin(this.angle + 0.5) * eyeOffset, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(headX + Math.cos(this.angle - 0.5) * eyeOffset, headY + Math.sin(this.angle - 0.5) * eyeOffset, 3, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.name} (${Math.floor(this.ves)} VES)`, headX, headY - this.radius - 8);
    }
  }

  die(killer = null) {
    if (!this.alive) return;
    this.alive = false;

    const drops = Math.min(50, Math.max(10, Math.floor(this.body.length / 2)));
    const valuePerDrop = Math.floor(this.ves / drops);

    for (let i = 0; i < this.body.length; i += Math.ceil(this.body.length / drops)) {
      const seg = this.body[i];
      spawnDeathLoot(seg.x + (Math.random() - 0.5) * 40, seg.y + (Math.random() - 0.5) * 40, valuePerDrop);
    }

    if (killer && killer.alive) killer.kills++;
    if (this.isPlayer) {
      endGame(false, "Tu cabeza ha chocado contra otro gusano. Perdiste todo tu botín.");
    }
  }
}

// ==========================================
// 3. LÓGICA Y BUCLE DEL JUEGO
// ==========================================
let worms = [];
let player = null;

function initGame() {
  worms = [];
  foodOrbs = [];
  currentPhase = 'PREPARATION';
  timeLeft = PREPARATION_TIME;
  safeSpawnFrames = 0;

  const playerX = WORLD_SIZE / 2;
  const playerY = WORLD_SIZE / 2;

  player = new Worm('player', 'César (Tú)', playerX, playerY, true, '#22c55e');
  worms.push(player);

  const botNames = ["Tiburón", "CriptoKing", "SBR_150", "ApurePro", "VeneGamer", "AlphaWorm", "BolivarVip", "NocheSera", "LlaneroEx", "FastLoot"];
  
  for (let i = 0; i < INITIAL_BOTS; i++) {
    let bx, by;
    do {
      bx = Math.random() * (WORLD_SIZE - 1000) + 500;
      by = Math.random() * (WORLD_SIZE - 1000) + 500;
    } while (Math.hypot(bx - playerX, by - playerY) < 800);

    const bName = botNames[i % botNames.length] + "_" + (i + 1);
    const color = `hsl(${Math.random() * 360}, 70%, 60%)`;
    worms.push(new Worm(`bot_${i}`, bName, bx, by, false, color));
  }
}

function checkCollisions() {
  if (currentPhase !== 'COMBAT') return;
  
  if (safeSpawnFrames > 0) {
    safeSpawnFrames--;
    return;
  }

  for (let w1 of worms) {
    if (!w1.alive) continue;
    for (let w2 of worms) {
      if (!w2.alive) continue;
      
      const startIndex = (w1.id === w2.id) ? 15 : 0;
      
      for (let i = startIndex; i < w2.body.length; i++) {
        const seg = w2.body[i];
        if (Math.hypot(w1.x - seg.x, w1.y - seg.y) < w1.radius + 1) {
          w1.die(w2);
          break;
        }
      }
    }
  }
}

function updateHUD() {
  if (!player) return;
  const vesDisplay = document.getElementById('ves-display');
  const aliveDisplay = document.getElementById('alive-display');
  const timerDisplay = document.getElementById('timer-display');
  
  if (vesDisplay) vesDisplay.innerText = `${Math.floor(player.ves).toLocaleString()} VES`;
  if (aliveDisplay) aliveDisplay.innerText = `${worms.filter(w => w.alive).length} / ${INITIAL_BOTS + 1}`;

  const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const s = (timeLeft % 60).toString().padStart(2, '0');
  if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;

  const timerLabel = document.getElementById('timer-label');
  const banner = document.getElementById('phase-banner');

  if (timerLabel && banner) {
    if (currentPhase === 'PREPARATION') {
      timerLabel.innerText = "Preparación";
      banner.innerText = `PREPARACIÓN FLASH: ${s}s (Ubícate)`;
      banner.style.color = "#38bdf8";
      banner.style.borderColor = "#38bdf8";
    } else {
      timerLabel.innerText = "Combate Exprés";
      banner.innerText = `¡COMBATE ACTIVO: ${s}s restantes (¡A matar y recoger!)!`;
      banner.style.color = "#ef4444";
      banner.style.borderColor = "#ef4444";
    }
  }

  const sorted = [...worms].filter(w => w.alive).sort((a, b) => b.ves - a.ves).slice(0, 5);
  const lbContainer = document.getElementById('lb-content');
  if (lbContainer) {
    lbContainer.innerHTML = '';
    sorted.forEach((w, index) => {
      const row = document.createElement('div');
      row.className = `lb-row ${w.isPlayer ? 'player' : ''}`;
      row.innerHTML = `<span>#${index + 1} ${w.name.substring(0, 10)}</span> <span>${Math.floor(w.ves)} VES</span>`;
      lbContainer.appendChild(row);
    });
  }
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!gameActive) return;
    
    timeLeft--;

    if (timeLeft <= 0) {
      if (currentPhase === 'PREPARATION') {
        currentPhase = 'COMBAT';
        timeLeft = COMBAT_TIME; 
        safeSpawnFrames = 180; 
      } else {
        endGame(true, "¡1 minuto cumplido con éxito! Has sobrevivido y te llevas tu botín acumulado.");
      }
    }
  }, 1000);
}

function drawMinimap() {
  mCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
  const scale = minimapCanvas.width / WORLD_SIZE;
  worms.forEach(w => {
    if (!w.alive) return;
    mCtx.beginPath();
    mCtx.arc(w.x * scale, w.y * scale, w.isPlayer ? 3 : 1.5, 0, Math.PI * 2);
    mCtx.fillStyle = w.isPlayer ? '#4ade80' : 'rgba(255, 255, 255, 0.4)';
    mCtx.fill();
  });
}

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gameActive && player && player.alive) {
    const camera = { x: player.x - canvas.width / 2, y: player.y - canvas.height / 2 };

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridSize = 100;
    const startX = -camera.x % gridSize;
    const startY = -camera.y % gridSize;

    for (let x = startX; x < canvas.width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = startY; y < canvas.height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.strokeRect(-camera.x, -camera.y, WORLD_SIZE, WORLD_SIZE);

    worms.forEach(w => w.update());
    checkCollisions();

    foodOrbs.forEach(orb => {
      const sx = orb.x - camera.x;
      const sy = orb.y - camera.y;
      if (sx >= -20 && sx <= canvas.width + 20 && sy >= -20 && sy <= canvas.height + 20) {
        ctx.beginPath();
        ctx.arc(sx, sy, orb.radius, 0, Math.PI * 2);
        ctx.fillStyle = orb.color;
        ctx.shadowColor = orb.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    worms.forEach(w => w.draw(camera));
    updateHUD();
    drawMinimap();
  }

  requestAnimationFrame(gameLoop);
}

initGame();
gameActive = true;
startTimer();
requestAnimationFrame(gameLoop);

// ==========================================
// 4. FINALIZACIÓN Y GUARDADO DE DATOS (SUPABASE BLINDADO)
// ==========================================
async function saveGameResult(finalVes) {
  const sb = window.supabase && typeof window.supabase.createClient === 'function' 
    ? window.supabase.createClient('https://odecdkuwbkcvqekuekoc.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kZWNka3V3YmtjdnFla3Vla29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMTQzNDIsImV4cCI6MjEwODg5MDM0Mn0.Hi8GemXv6_ZDyBTPwJVqwAABlQ24smArzNhATaRYs7A') 
    : null;

  if (!sb) {
    console.warn("Supabase no está disponible para guardar el resultado.");
    return;
  }

  try {
    let userId = null;
    
    if (sb.auth && typeof sb.auth.getUser === 'function') {
      const { data: authData } = await sb.auth.getUser();
      if (authData && authData.user) {
        userId = authData.user.id;
      }
    }

    if (!userId) {
      const localKeys = Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (localKeys.length > 0) {
        const parsed = JSON.parse(localStorage.getItem(localKeys[0]));
        if (parsed && parsed.user) userId = parsed.user.id;
      }
    }

    if (!userId) {
      console.warn("No se encontró usuario activo para guardar el saldo.");
      return;
    }

    const { data: profile, error: fetchError } = await sb
      .from('profiles')
      .select('balance')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error("Error al obtener perfil:", fetchError.message);
      return;
    }

    const currentBalance = Number(profile ? profile.balance : 0);
    const amountWon = Number(finalVes) || 0;
    const newTotalBalance = currentBalance + amountWon;

    const { error: updateError } = await sb
      .from('profiles')
      .update({ balance: Math.floor(newTotalBalance) })
      .eq('id', userId);

    if (updateError) throw updateError;
    console.log(`¡Saldo actualizado con éxito! Anterior: ${currentBalance} + Ganado: ${amountWon} = Total: ${Math.floor(newTotalBalance)} VES`);
  } catch (err) {
    console.error("Error al actualizar saldo en Supabase:", err.message);
  }
}

function endGame(survived, reason) {
  gameActive = false;
  clearInterval(timerInterval);

  const endModal = document.getElementById('end-modal');
  const endTitle = document.getElementById('end-title');
  const endDesc = document.getElementById('end-desc');
  const endVes = document.getElementById('end-ves-amount');

  if (endModal) endModal.style.display = 'flex';

  const finalAmount = survived ? Math.floor(player.ves) : 0;

  if (survived) {
    if (endTitle) { endTitle.innerText = "¡VICTORIA & SOBREVIVENCIA!"; endTitle.style.color = "#4ade80"; }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = `${finalAmount.toLocaleString()} VES`;
  } else {
    if (endTitle) { endTitle.innerText = "HAS SIDO ELIMINADO"; endTitle.style.color = "#ef4444"; }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = "0 VES";
  }

  saveGameResult(finalAmount);
}