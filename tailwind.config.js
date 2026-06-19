/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--bg-primary)',
        secondary: 'var(--bg-secondary)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        border: 'var(--border)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)'
      },
      // 动画时长令牌：语义命名而非数值，便于全局调整。
      // 微交互→fast、标准容器→base、弹窗→slow、强调过渡→slower。
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
        slow: '300ms',
        slower: '450ms',
      },
      // 动画曲线令牌：spring 弹性、smooth 平滑、standard 默认 ease-out。
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
        standard: 'ease-out',
      },
      // 可复用关键帧：供后续变更（consistency/skeleton/loader）消费。
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 300ms ease-out',
        'slide-down': 'slide-down 300ms ease-out',
        'scale-in': 'scale-in 300ms ease-out',
        shimmer: 'shimmer 1.5s linear infinite',
      },
    },
  },
  plugins: [],
}
