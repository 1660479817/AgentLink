<script setup>
// 横向组合标：标识当 X，后接 Knot，读作 XKnot。几何取自仓库根 `docs/xknot-lockup.svg`，
// 内联在这里是为了让字标跟着主题换色；尺寸由使用处用 CSS 定高，宽度按 3.38:1 自己走。
</script>

<template>
  <svg
    class="lockup"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 741.4768 219.2"
    role="img"
    aria-label="XKnot"
  >
    <!-- 标识实心高度 168，与字高 160 同一条带；四周留白 25.6。 -->
    <g transform="translate(25.6 25.6) scale(0.8102) translate(-44.3188 -44.3188)">
      <!-- 与 docs/xknot-mark.svg 同一套几何：环 r30/r16，四臂 45 度，端头 r16，内切口 r46。 -->
      <defs>
        <path
          id="xknot-lockup-arm"
          d="M 43.128 16 L 124 16 A 16 16 0 0 0 124 -16 L 43.128 -16 A 46 46 0 0 1 43.128 16 Z"
        />
      </defs>
      <g class="lockup-mark" transform="translate(148 148)">
        <circle r="23" fill="none" stroke="currentColor" stroke-width="14" />
        <use href="#xknot-lockup-arm" transform="rotate(45)" />
        <use href="#xknot-lockup-arm" transform="rotate(135)" />
        <use href="#xknot-lockup-arm" transform="rotate(225)" />
        <use href="#xknot-lockup-arm" transform="rotate(315)" />
      </g>
    </g>
    <!-- Knot 是 Helvetica Neue Bold 的轮廓，字距 0，渲染不依赖系统字体。 -->
    <g class="lockup-word" transform="translate(208.5378 189.6) scale(0.2241 -0.2241)">
      <path d="M69 714V0H226V230L316 321L531 0H728L422 432L701 714H505L226 418V714Z" />
      <path
        transform="translate(722 0)"
        d="M54 517V0H196V271Q196 350 222.0 384.5Q248 419 306 419Q357 419 377.0 387.5Q397 356 397 292V0H539V318Q539 366 530.5 405.5Q522 445 501.0 472.5Q480 500 443.5 515.5Q407 531 350 531Q305 531 262.0 510.5Q219 490 192 445H189V517Z"
      />
      <path
        transform="translate(1315 0)"
        d="M180 258Q180 289 186.0 319.0Q192 349 206.5 372.0Q221 395 245.0 409.5Q269 424 305 424Q341 424 365.5 409.5Q390 395 404.5 372.0Q419 349 425.0 319.0Q431 289 431 258Q431 227 425.0 197.5Q419 168 404.5 144.5Q390 121 365.5 107.0Q341 93 305 93Q269 93 245.0 107.0Q221 121 206.5 144.5Q192 168 186.0 197.5Q180 227 180 258ZM38 258Q38 196 57.0 146.0Q76 96 111.0 60.5Q146 25 195.0 6.0Q244 -13 305 -13Q366 -13 415.5 6.0Q465 25 500.0 60.5Q535 96 554.0 146.0Q573 196 573 258Q573 320 554.0 370.5Q535 421 500.0 456.5Q465 492 415.5 511.5Q366 531 305 531Q244 531 195.0 511.5Q146 492 111.0 456.5Q76 421 57.0 370.5Q38 320 38 258Z"
      />
      <path
        transform="translate(1926 0)"
        d="M234 517V672H92V517H6V422H92V117Q92 78 105.0 54.0Q118 30 140.5 17.0Q163 4 192.5 -0.5Q222 -5 255 -5Q276 -5 298.0 -4.0Q320 -3 338 0V110Q328 108 317.0 107.0Q306 106 294 106Q258 106 246.0 118.0Q234 130 234 166V422H338V517Z"
      />
    </g>
  </svg>
</template>

<style scoped>
.lockup {
  display: block;
  width: auto;
}

/* 浅色底用深橙标 + 高级黑字。 */
.lockup-mark {
  color: #c2410c;
  fill: #c2410c;
}

.lockup-word {
  fill: #050505;
}
</style>

<!-- 深色底整份转白，和 docs/xknot-lockup-inverse.svg 一致。主题挂在 :root 上，
     没法用 scoped 选到，所以单独放一块全局样式。 -->
<style>
:root[data-theme="dark"] .lockup-mark,
:root[data-theme="dark"] .lockup-word {
  color: #ffffff;
  fill: #ffffff;
}
</style>
