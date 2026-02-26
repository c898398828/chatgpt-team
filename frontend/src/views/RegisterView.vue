<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const router = useRouter()
const route = useRoute()

const email = ref('')
const code = ref('')
const password = ref('')
const confirmPassword = ref('')
const inviteCode = ref('')
const inviteLocked = ref(false)

const error = ref('')
const success = ref('')
const loading = ref(false)
const sendingCode = ref(false)
const countdown = ref(0)

let countdownTimer: number | null = null

const startCountdown = (seconds: number) => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
  countdown.value = seconds
  countdownTimer = window.setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 1)
    if (countdown.value <= 0 && countdownTimer) {
      window.clearInterval(countdownTimer)
      countdownTimer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
})

const applyInviteFromQuery = () => {
  const raw = route.query.invite ?? route.query.inviteCode ?? route.query.code
  const value = Array.isArray(raw) ? raw[0] : raw
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized) {
    inviteCode.value = normalized
    inviteLocked.value = true
  } else {
    inviteLocked.value = false
  }
}

onMounted(() => {
  applyInviteFromQuery()
})

watch(() => route.query, () => applyInviteFromQuery(), { deep: true })

const handleSendCode = async () => {
  error.value = ''
  success.value = ''

  const trimmedEmail = email.value.trim().toLowerCase()
  if (!trimmedEmail) {
    error.value = '请输入邮箱'
    return
  }

  sendingCode.value = true
  try {
    await authService.sendRegisterCode(trimmedEmail)
    success.value = '验证码已发送，请检查邮箱'
    startCountdown(60)
  } catch (err: any) {
    error.value = err.response?.data?.error || '发送验证码失败，请重试'
  } finally {
    sendingCode.value = false
  }
}

const handleRegister = async () => {
  error.value = ''
  success.value = ''
  loading.value = true

  try {
    const trimmedEmail = email.value.trim().toLowerCase()
    if (!trimmedEmail) {
      error.value = '请输入邮箱'
      return
    }
    if (!code.value.trim()) {
      error.value = '请输入验证码'
      return
    }
    if (!password.value || password.value.length < 6) {
      error.value = '密码至少需要 6 个字符'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '两次输入的密码不一致'
      return
    }

    await authService.register({
      email: trimmedEmail,
      code: code.value.trim(),
      password: password.value,
      ...(inviteCode.value.trim() ? { inviteCode: inviteCode.value.trim() } : {}),
    })

    router.push('/admin')
  } catch (err: any) {
    error.value = err.response?.data?.error || '注册失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-shell">
    <div class="register-shell__bg" aria-hidden="true">
      <div class="register-orb orb-coral"></div>
      <div class="register-orb orb-cyan"></div>
      <div class="register-orb orb-amber"></div>
      <div class="register-grid"></div>
    </div>

    <main class="register-layout">
      <section class="register-brand">
        <p class="brand-kicker">BOARDING SYSTEM</p>
        <h1>加入系统</h1>
        <p class="brand-desc">
          创建账号后可进入后台管理面板，使用邀请码可自动关联邀请关系。
        </p>
      </section>

      <section class="register-panel">
        <div class="register-header">
          <h2>创建账号</h2>
          <p>使用邮箱完成注册</p>
        </div>

        <form @submit.prevent="handleRegister" class="register-form">
          <div class="space-y-2">
            <Label for="email" class="register-label">邮箱</Label>
            <Input
              id="email"
              v-model="email"
              type="email"
              placeholder="name@example.com"
              required
              class="register-input"
            />
          </div>

          <div class="space-y-2">
            <Label for="code" class="register-label">验证码</Label>
            <div class="code-row">
              <Input
                id="code"
                v-model="code"
                type="text"
                inputmode="numeric"
                placeholder="6 位数字"
                required
                class="register-input"
              />
              <Button
                type="button"
                class="send-code-btn"
                :disabled="sendingCode || countdown > 0"
                @click="handleSendCode"
              >
                {{ countdown > 0 ? `${countdown}s` : (sendingCode ? '发送中...' : '发送验证码') }}
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            <Label for="password" class="register-label">密码</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              placeholder="至少 6 个字符"
              required
              class="register-input"
            />
          </div>

          <div class="space-y-2">
            <Label for="confirmPassword" class="register-label">确认密码</Label>
            <Input
              id="confirmPassword"
              v-model="confirmPassword"
              type="password"
              placeholder="再次输入密码"
              required
              class="register-input"
            />
          </div>

          <div class="space-y-2">
            <Label for="inviteCode" class="register-label">
              邀请码{{ inviteLocked ? '（来自邀请链接）' : '（可选）' }}
            </Label>
            <Input
              id="inviteCode"
              v-model="inviteCode"
              type="text"
              :readonly="inviteLocked"
              placeholder="填写邀请码可关联邀请人"
              class="register-input"
            />
            <p v-if="inviteLocked" class="invite-hint">
              已从邀请链接自动填充，当前不可修改。
            </p>
          </div>

          <div v-if="error" class="register-error">
            {{ error }}
          </div>

          <div v-if="success" class="register-success">
            {{ success }}
          </div>

          <Button
            type="submit"
            class="register-submit"
            :disabled="loading"
          >
            <span v-if="loading" class="register-spinner"></span>
            {{ loading ? '正在注册...' : '注册' }}
          </Button>

          <div class="register-login">
            已有账号？
            <router-link to="/login">去登录</router-link>
          </div>
        </form>
      </section>
    </main>

    <footer class="register-footer">© 2026 Boarding System</footer>
  </div>
</template>

<style scoped>
.register-shell {
  position: relative;
  min-height: 100vh;
  padding: 1.2rem 1rem 0.75rem;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #f7f8fb;
}

.register-shell__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.register-orb {
  position: absolute;
  border-radius: 9999px;
  opacity: 0.35;
  filter: blur(8px);
  animation: floatOrb 16s ease-in-out infinite;
}

.orb-coral {
  width: min(55vw, 620px);
  height: min(55vw, 620px);
  top: -12%;
  left: -10%;
  background: radial-gradient(circle at 35% 35%, #ff9a79, #ff6a88 70%);
}

.orb-cyan {
  width: min(45vw, 520px);
  height: min(45vw, 520px);
  right: -10%;
  top: 10%;
  background: radial-gradient(circle at 60% 40%, #4fd1ff, #4f7cff 75%);
  animation-delay: 3s;
}

.orb-amber {
  width: min(50vw, 560px);
  height: min(50vw, 560px);
  left: 25%;
  bottom: -28%;
  background: radial-gradient(circle at 45% 40%, #ffd66b, #ff9f5d 78%);
  animation-delay: 6s;
}

.register-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(20, 36, 71, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(20, 36, 71, 0.045) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(circle at 50% 45%, black, transparent 78%);
}

.register-layout {
  position: relative;
  z-index: 2;
  width: min(1080px, 96vw);
  display: grid;
  grid-template-columns: 0.95fr 1.05fr;
  border-radius: 28px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 26px 60px rgba(12, 28, 58, 0.15);
  backdrop-filter: blur(18px);
  background: linear-gradient(132deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.62));
}

.register-brand {
  padding: clamp(1.75rem, 2.6vw, 2.8rem);
  background: linear-gradient(155deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0.12));
  color: #173056;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand-kicker {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  color: rgba(12, 38, 78, 0.72);
  font-weight: 600;
}

.register-brand h1 {
  margin: 0.85rem 0 0;
  font-family: "XindiXueshan", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: clamp(2rem, 4vw, 2.8rem);
  line-height: 1.15;
  font-weight: 600;
}

.brand-desc {
  margin-top: 0.95rem;
  max-width: 21rem;
  font-size: 0.95rem;
  line-height: 1.7;
  color: rgba(17, 42, 78, 0.76);
}

.register-panel {
  padding: clamp(1.1rem, 2.1vw, 1.85rem);
  background: rgba(255, 255, 255, 0.85);
}

.register-form {
  display: grid;
  gap: 0.72rem;
}

.register-header h2 {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 700;
  color: #122647;
}

.register-header p {
  margin: 0.35rem 0 0.95rem;
  color: #4a6388;
  font-size: 0.9rem;
}

.register-label {
  display: inline-block;
  font-size: 0.75rem;
  margin-left: 0.2rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #47638f;
  font-weight: 600;
}

.register-input {
  height: 2.9rem;
  border-radius: 0.9rem;
  border: 1px solid #d6e2f1;
  background: rgba(248, 252, 255, 0.92);
  color: #183056;
  font-weight: 500;
  transition: all 0.25s ease;
}

.register-input:hover {
  border-color: #bfcee3;
}

.register-input:focus-visible {
  border-color: #4e7eea;
  box-shadow: 0 0 0 4px rgba(78, 126, 234, 0.18);
}

.code-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.6rem;
}

.send-code-btn {
  height: 2.9rem;
  border-radius: 0.9rem;
  background: #1b3672;
  color: #fff;
  font-size: 0.84rem;
  padding: 0 0.9rem;
}

.send-code-btn:hover {
  filter: brightness(1.08);
}

.send-code-btn:disabled {
  opacity: 0.8;
}

.invite-hint {
  font-size: 0.76rem;
  color: #60779b;
  margin-top: 0.22rem;
}

.register-error {
  border: 1px solid rgba(224, 82, 72, 0.26);
  background: rgba(255, 235, 233, 0.85);
  color: #bf3e35;
  border-radius: 0.85rem;
  padding: 0.72rem 0.86rem;
  font-size: 0.86rem;
}

.register-success {
  border: 1px solid rgba(75, 156, 93, 0.26);
  background: rgba(234, 252, 239, 0.85);
  color: #2f8b4a;
  border-radius: 0.85rem;
  padding: 0.72rem 0.86rem;
  font-size: 0.86rem;
}

.register-submit {
  width: 100%;
  height: 2.95rem;
  border-radius: 0.9rem;
  background: linear-gradient(135deg, #1d3670, #2f5fcf);
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.04em;
  box-shadow: 0 12px 22px rgba(36, 80, 175, 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.register-submit:hover {
  transform: translateY(-1px);
  filter: saturate(1.06);
  box-shadow: 0 16px 26px rgba(36, 80, 175, 0.34);
}

.register-submit:active {
  transform: translateY(0);
}

.register-submit:disabled {
  opacity: 0.85;
}

.register-spinner {
  width: 0.95rem;
  height: 0.95rem;
  margin-right: 0.45rem;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 9999px;
  animation: spin 0.9s linear infinite;
}

.register-login {
  text-align: center;
  font-size: 0.86rem;
  color: #4b658e;
}

.register-login a {
  color: #1b3980;
  font-weight: 600;
  margin-left: 0.25rem;
  text-decoration: none;
}

.register-login a:hover {
  text-decoration: underline;
}

.register-footer {
  position: relative;
  z-index: 2;
  margin-top: 0.6rem;
  color: rgba(20, 42, 78, 0.52);
  font-size: 0.77rem;
  letter-spacing: 0.04em;
}

@keyframes floatOrb {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(0, -24px, 0) scale(1.04);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .register-layout {
    grid-template-columns: 1fr;
    max-width: 560px;
  }

  .register-brand {
    padding-bottom: 0.9rem;
  }
}

@media (max-width: 640px) {
  .register-shell {
    padding: 1.25rem 0.75rem;
  }

  .register-layout {
    border-radius: 22px;
  }

  .register-brand {
    padding: 1.4rem 1.2rem 1rem;
  }

  .register-panel {
    padding: 1.1rem;
  }

  .code-row {
    grid-template-columns: 1fr;
  }

  .send-code-btn {
    width: 100%;
  }
}
</style>
