<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const handleLogin = async () => {
  error.value = ''
  loading.value = true

  try {
    await authService.login(username.value, password.value)
    router.push('/admin')
  } catch (err: any) {
    error.value = err.response?.data?.error || '登录失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-shell">
    <div class="login-shell__bg" aria-hidden="true">
      <div class="login-orb orb-coral"></div>
      <div class="login-orb orb-cyan"></div>
      <div class="login-orb orb-amber"></div>
      <div class="login-grid"></div>
    </div>

    <main class="login-layout">
      <section class="login-brand">
        <p class="brand-kicker">BOARDING SYSTEM</p>
        <h1>欢迎回来</h1>
        <p class="brand-desc">
          统一管理账号、订单与兑换流程，保持团队运营稳定高效。
        </p>
      </section>

      <section class="login-panel">
        <div class="login-header">
          <h2>登录后台</h2>
          <p>请输入账号密码继续操作</p>
        </div>

        <form @submit.prevent="handleLogin" class="login-form">
          <div class="space-y-2">
            <Label for="username" class="login-label">账号</Label>
            <Input
              id="username"
              v-model="username"
              type="text"
              placeholder="请输入用户名或邮箱"
              required
              class="login-input"
            />
          </div>

          <div class="space-y-2">
            <Label for="password" class="login-label">密码</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              placeholder="请输入密码"
              required
              class="login-input"
            />
          </div>

          <div v-if="error" class="login-error">
            {{ error }}
          </div>

          <Button
            type="submit"
            class="login-submit"
            :disabled="loading"
          >
            <span v-if="loading" class="login-spinner"></span>
            {{ loading ? '正在登录...' : '登录' }}
          </Button>

          <div class="login-register">
            还没有账号？
            <router-link to="/register">去注册</router-link>
          </div>
        </form>
      </section>
    </main>

    <footer class="login-footer">© 2026 Boarding System</footer>
  </div>
</template>

<style scoped>
.login-shell {
  position: relative;
  min-height: 100vh;
  padding: 1.2rem 1rem 0.75rem;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #f7f8fb;
}

.login-shell__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.login-orb {
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

.login-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(20, 36, 71, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(20, 36, 71, 0.045) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(circle at 50% 45%, black, transparent 78%);
}

.login-layout {
  position: relative;
  z-index: 2;
  width: min(980px, 92vw);
  min-height: clamp(500px, 63vh, 560px);
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-radius: 28px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 26px 60px rgba(12, 28, 58, 0.15);
  backdrop-filter: blur(18px);
  background: linear-gradient(132deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.62));
}

.login-brand {
  padding: clamp(2.2rem, 3.1vw, 3.3rem);
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

.login-brand h1 {
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

.login-panel {
  padding: clamp(2rem, 3vw, 2.9rem);
  display: grid;
  align-content: center;
  background: rgba(255, 255, 255, 0.85);
}

.login-form {
  display: grid;
  gap: 1.05rem;
}

.login-form .space-y-2 {
  display: grid;
  gap: 0.4rem;
}

.login-header h2 {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 700;
  color: #122647;
}

.login-header p {
  margin: 0.3rem 0 0.85rem;
  color: #4a6388;
  font-size: 0.9rem;
}

.login-label {
  display: inline-block;
  font-size: 0.75rem;
  margin-left: 0.2rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #47638f;
  font-weight: 600;
}

.login-input {
  height: 3rem;
  border-radius: 0.9rem;
  border: 1px solid #d6e2f1;
  background: rgba(248, 252, 255, 0.92);
  color: #183056;
  font-weight: 500;
  transition: all 0.25s ease;
}

.login-input:hover {
  border-color: #bfcee3;
}

.login-input:focus-visible {
  border-color: #4e7eea;
  box-shadow: 0 0 0 4px rgba(78, 126, 234, 0.18);
}

.login-error {
  border: 1px solid rgba(224, 82, 72, 0.26);
  background: rgba(255, 235, 233, 0.85);
  color: #bf3e35;
  border-radius: 0.85rem;
  padding: 0.72rem 0.86rem;
  font-size: 0.86rem;
}

.login-submit {
  width: 100%;
  height: 2.95rem;
  margin-top: 0.2rem;
  border-radius: 0.9rem;
  background: linear-gradient(135deg, #1d3670, #2f5fcf);
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.04em;
  box-shadow: 0 12px 22px rgba(36, 80, 175, 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.login-submit:hover {
  transform: translateY(-1px);
  filter: saturate(1.06);
  box-shadow: 0 16px 26px rgba(36, 80, 175, 0.34);
}

.login-submit:active {
  transform: translateY(0);
}

.login-submit:disabled {
  opacity: 0.85;
}

.login-spinner {
  width: 0.95rem;
  height: 0.95rem;
  margin-right: 0.45rem;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 9999px;
  animation: spin 0.9s linear infinite;
}

.login-register {
  text-align: center;
  font-size: 0.86rem;
  margin-top: 0.1rem;
  color: #4b658e;
}

.login-register a {
  color: #1b3980;
  font-weight: 600;
  margin-left: 0.25rem;
  text-decoration: none;
}

.login-register a:hover {
  text-decoration: underline;
}

.login-footer {
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
  .login-layout {
    grid-template-columns: 1fr;
    min-height: auto;
    max-width: 620px;
  }

  .login-brand {
    padding-bottom: 1rem;
  }
}

@media (max-width: 640px) {
  .login-shell {
    padding: 1.25rem 0.75rem;
  }

  .login-layout {
    border-radius: 22px;
  }

  .login-brand {
    padding: 1.4rem 1.2rem 1.1rem;
  }

  .login-panel {
    padding: 1.2rem;
  }
}
</style>
