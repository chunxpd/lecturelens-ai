import type { DiagramPreset } from '../types/lecture';

export const DIAGRAM_LABELS: Record<DiagramPreset, string> = {
  none: '도식 없음 (텍스트/수식 중심)',
  'seq2seq-bottleneck': 'Seq2Seq 고정 벡터 병목 (Information Bottleneck)',
  'attention-alignment': 'Attention 정렬 점수 (Encoder-Decoder Alignment)',
  'qkv-projection': 'Query · Key · Value 선형 투영 (Linear Projections)',
  'scaled-dot-product': 'Scaled Dot-Product Attention 연산 흐름',
  'multi-head-attention': 'Multi-Head Attention 병렬 구조',
  'positional-encoding': 'Positional Encoding 사인/코사인 위상',
  'transformer-architecture': 'Transformer Encoder-Decoder 전체 구조',
  'pipeline-overview': '강의 핵심 파이프라인 요약 (Pipeline Overview)',
};

export function buildDiagramSvgMarkup(preset: DiagramPreset, width = 720, height = 405): string {
  if (preset === 'none') return '';

  const bg = '#FFFFFF';
  const slate = '#0F172A';
  const muted = '#475569';
  const border = '#CBD5E1';
  const cobalt = '#1E3A8A';
  const cobaltLight = '#EFF6FF';
  const azure = '#0284C7';
  const azureLight = '#F0F9FF';
  const indigo = '#4F46E5';
  const indigoLight = '#EEF2FF';
  const amber = '#D97706';
  const amberLight = '#FFFBEB';

  const arrowDefs = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="${slate}" />
      </marker>
      <marker id="arrow-cobalt" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="${cobalt}" />
      </marker>
    </defs>
  `;

  let body = '';

  switch (preset) {
    case 'seq2seq-bottleneck': {
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Seq2Seq 고정 길이 컨텍스트 벡터 병목 (Fixed-Vector Bottleneck)</text>
        ${[0, 1, 2, 3]
          .map(
            (i) => `
          <rect x="${45 + i * 75}" y="130" width="56" height="44" rx="6" fill="${azureLight}" stroke="${azure}" stroke-width="1.5" />
          <text x="${73 + i * 75}" y="157" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" fill="${slate}">h${i + 1}</text>
          <rect x="${45 + i * 75}" y="220" width="56" height="36" rx="6" fill="#F8FAFC" stroke="${border}" stroke-width="1.5" />
          <text x="${73 + i * 75}" y="243" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${muted}">x${i + 1}</text>
          <line x1="${73 + i * 75}" y1="220" x2="${73 + i * 75}" y2="178" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />
          ${i < 3 ? `<line x1="${101 + i * 75}" y1="152" x2="${116 + i * 75}" y2="152" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />` : ''}
        `,
          )
          .join('')}
        <line x1="326" y1="152" x2="364" y2="152" stroke="${amber}" stroke-width="2.5" marker-end="url(#arrow)" />
        <rect x="368" y="120" width="90" height="64" rx="8" fill="${amberLight}" stroke="${amber}" stroke-width="2" />
        <text x="413" y="148" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="13" font-weight="700" fill="${amber}">Context c</text>
        <text x="413" y="168" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="${muted}">병목 구간</text>
        <line x1="458" y1="152" x2="496" y2="152" stroke="${cobalt}" stroke-width="2" marker-end="url(#arrow-cobalt)" />
        ${[0, 1]
          .map(
            (i) => `
          <rect x="${500 + i * 85}" y="130" width="62" height="44" rx="6" fill="${indigoLight}" stroke="${indigo}" stroke-width="1.5" />
          <text x="${531 + i * 85}" y="157" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" fill="${slate}">s${i + 1}</text>
          <rect x="${500 + i * 85}" y="70" width="62" height="32" rx="6" fill="#F8FAFC" stroke="${border}" stroke-width="1.5" />
          <text x="${531 + i * 85}" y="90" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${slate}">y${i + 1}</text>
          <line x1="${531 + i * 85}" y1="130" x2="${531 + i * 85}" y2="106" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />
          ${i === 0 ? `<line x1="562" y1="152" x2="581" y2="152" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />` : ''}
        `,
          )
          .join('')}
        <text x="360" y="325" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="13" fill="${muted}">긴 입력 시퀀스의 모든 정보를 단일 고정 벡터 c ∈ ℝ^d 로 압축해야 하므로 정보 손실 발생</text>
      `;
      break;
    }

    case 'attention-alignment': {
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Attention 동적 정렬 및 가중합 (Dynamic Alignment &amp; Weighted Sum)</text>
        ${[0, 1, 2, 3]
          .map(
            (i) => `
          <rect x="${55 + i * 110}" y="270" width="76" height="44" rx="6" fill="${azureLight}" stroke="${azure}" stroke-width="1.5" />
          <text x="${93 + i * 110}" y="297" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" fill="${slate}">h${i + 1} (K,V)</text>
          <line x1="${93 + i * 110}" y1="270" x2="260" y2="196" stroke="${i === 1 ? cobalt : '#94A3B8'}" stroke-width="${i === 1 ? 3 : 1.5}" />
          <text x="${(93 + i * 110 + 260) / 2}" y="232" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" font-weight="${i === 1 ? '700' : '400'}" fill="${i === 1 ? cobalt : muted}">α${i + 1}=${['0.12', '0.68', '0.14', '0.06'][i]}</text>
        `,
          )
          .join('')}
        <rect x="190" y="142" width="140" height="50" rx="8" fill="${cobaltLight}" stroke="${cobalt}" stroke-width="2" />
        <text x="260" y="165" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${cobalt}">c_t = Σ α_ti h_i</text>
        <text x="260" y="182" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="11" fill="${muted}">Weighted Context</text>
        <rect x="490" y="142" width="160" height="50" rx="8" fill="${indigoLight}" stroke="${indigo}" stroke-width="2" />
        <text x="570" y="165" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${indigo}">Decoder s_t (Q)</text>
        <text x="570" y="182" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="11" fill="${muted}">현재 디코딩 시점</text>
        <line x1="330" y1="167" x2="486" y2="167" stroke="${cobalt}" stroke-width="2" marker-end="url(#arrow-cobalt)" />
        <rect x="520" y="64" width="100" height="40" rx="6" fill="#F8FAFC" stroke="${border}" stroke-width="1.5" />
        <text x="570" y="89" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="600" fill="${slate}">Output y_t</text>
        <line x1="570" y1="142" x2="570" y2="108" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />
      `;
      break;
    }

    case 'qkv-projection': {
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Query · Key · Value 선형 투영 (Linear Projections from X)</text>
        <rect x="45" y="145" width="130" height="110" rx="8" fill="#F8FAFC" stroke="${slate}" stroke-width="1.8" />
        <text x="110" y="192" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="15" font-weight="700" fill="${slate}">Input X</text>
        <text x="110" y="216" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${muted}">[N × d_model]</text>

        ${[
          { label: 'W_Q', out: 'Query (Q)', dim: '[N × d_k]', y: 85, color: cobalt, fill: cobaltLight },
          { label: 'W_K', out: 'Key (K)', dim: '[N × d_k]', y: 185, color: azure, fill: azureLight },
          { label: 'W_V', out: 'Value (V)', dim: '[N × d_v]', y: 285, color: indigo, fill: indigoLight },
        ]
          .map(
            (row) => `
          <line x1="175" y1="200" x2="266" y2="${row.y + 24}" stroke="${row.color}" stroke-width="1.8" marker-end="url(#arrow)" />
          <rect x="270" y="${row.y}" width="120" height="48" rx="6" fill="#FFFFFF" stroke="${row.color}" stroke-width="1.5" />
          <text x="330" y="${row.y + 22}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${row.color}">× ${row.label}</text>
          <text x="330" y="${row.y + 39}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="${muted}">[d_model × d_k]</text>
          <line x1="390" y1="${row.y + 24}" x2="466" y2="${row.y + 24}" stroke="${row.color}" stroke-width="1.8" marker-end="url(#arrow)" />
          <rect x="470" y="${row.y}" width="190" height="48" rx="8" fill="${row.fill}" stroke="${row.color}" stroke-width="1.8" />
          <text x="565" y="${row.y + 22}" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="14" font-weight="700" fill="${row.color}">${row.out}</text>
          <text x="565" y="${row.y + 39}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="${slate}">${row.dim}</text>
        `,
          )
          .join('')}
      `;
      break;
    }

    case 'scaled-dot-product': {
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Scaled Dot-Product Attention 데이터 흐름</text>
        <rect x="60" y="305" width="90" height="40" rx="6" fill="${cobaltLight}" stroke="${cobalt}" stroke-width="1.5" />
        <text x="105" y="330" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${cobalt}">Q [N×d_k]</text>

        <rect x="200" y="305" width="90" height="40" rx="6" fill="${azureLight}" stroke="${azure}" stroke-width="1.5" />
        <text x="245" y="330" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${azure}">K [N×d_k]</text>

        <rect x="490" y="305" width="90" height="40" rx="6" fill="${indigoLight}" stroke="${indigo}" stroke-width="1.5" />
        <text x="535" y="330" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${indigo}">V [N×d_v]</text>

        <rect x="115" y="232" width="120" height="40" rx="6" fill="#F8FAFC" stroke="${slate}" stroke-width="1.5" />
        <text x="175" y="257" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="600" fill="${slate}">MatMul (Q·Kᵀ)</text>

        <line x1="105" y1="305" x2="155" y2="276" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />
        <line x1="245" y1="305" x2="195" y2="276" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />

        <rect x="115" y="168" width="120" height="38" rx="6" fill="${amberLight}" stroke="${amber}" stroke-width="1.5" />
        <text x="175" y="192" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" font-weight="700" fill="${amber}">Scale (÷ √d_k)</text>
        <line x1="175" y1="232" x2="175" y2="210" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />

        <rect x="275" y="168" width="135" height="38" rx="6" fill="#F8FAFC" stroke="${border}" stroke-width="1.5" />
        <text x="342" y="192" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${muted}">Mask (Opt.)</text>
        <line x1="235" y1="187" x2="271" y2="187" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />

        <rect x="275" y="104" width="135" height="40" rx="6" fill="${cobaltLight}" stroke="${cobalt}" stroke-width="1.8" />
        <text x="342" y="129" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${cobalt}">Softmax [N×N]</text>
        <line x1="342" y1="168" x2="342" y2="148" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />

        <rect x="460" y="104" width="150" height="40" rx="6" fill="${indigoLight}" stroke="${indigo}" stroke-width="1.8" />
        <text x="535" y="129" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${indigo}">MatMul (× V)</text>
        <line x1="410" y1="124" x2="456" y2="124" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />
        <line x1="535" y1="305" x2="535" y2="148" stroke="${indigo}" stroke-width="1.5" marker-end="url(#arrow)" />

        <rect x="460" y="42" width="150" height="36" rx="6" fill="${cobalt}" />
        <text x="535" y="65" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="#FFFFFF">Output [N×d_v]</text>
        <line x1="535" y1="104" x2="535" y2="82" stroke="${slate}" stroke-width="1.5" marker-end="url(#arrow)" />
      `;
      break;
    }

    case 'multi-head-attention': {
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Multi-Head Attention 병렬 부분 공간 투영 (h Heads)</text>
        <rect x="260" y="318" width="200" height="40" rx="6" fill="#F8FAFC" stroke="${slate}" stroke-width="1.5" />
        <text x="360" y="343" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="600" fill="${slate}">Q, K, V [N × d_model]</text>

        ${[0, 1, 2]
          .map((i) => {
            const cx = 150 + i * 210;
            return `
            <line x1="360" y1="318" x2="${cx}" y2="268" stroke="${slate}" stroke-width="1.3" marker-end="url(#arrow)" />
            <rect x="${cx - 75}" y="220" width="150" height="42" rx="6" fill="#FFFFFF" stroke="${azure}" stroke-width="1.5" />
            <text x="${cx}" y="245" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${azure}">Linear (W_i^Q,K,V)</text>
            <line x1="${cx}" y1="220" x2="${cx}" y2="190" stroke="${slate}" stroke-width="1.3" marker-end="url(#arrow)" />
            <rect x="${cx - 75}" y="144" width="150" height="42" rx="6" fill="${cobaltLight}" stroke="${cobalt}" stroke-width="1.8" />
            <text x="${cx}" y="169" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="13" font-weight="700" fill="${cobalt}">Head ${i + 1} Attention</text>
            <line x1="${cx}" y1="144" x2="360" y2="112" stroke="${cobalt}" stroke-width="1.5" marker-end="url(#arrow-cobalt)" />
          `;
          })
          .join('')}

        <rect x="190" y="72" width="340" height="36" rx="6" fill="${indigoLight}" stroke="${indigo}" stroke-width="1.8" />
        <text x="360" y="95" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${indigo}">Concat(head_1..h) · W_O → [N × d_model]</text>
      `;
      break;
    }

    case 'positional-encoding': {
      const pts1 = Array.from({ length: 45 }, (_, i) => {
        const x = 70 + i * 13;
        const y = 170 - Math.sin(i * 0.35) * 48;
        return `${x},${y.toFixed(1)}`;
      }).join(' ');
      const pts2 = Array.from({ length: 45 }, (_, i) => {
        const x = 70 + i * 13;
        const y = 170 - Math.cos(i * 0.14) * 48;
        return `${x},${y.toFixed(1)}`;
      }).join(' ');

      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Positional Encoding (사인/코사인 주기 함수 기반 위치 인코딩)</text>
        <line x1="60" y1="170" x2="660" y2="170" stroke="${border}" stroke-width="1.5" />
        <line x1="70" y1="90" x2="70" y2="250" stroke="${border}" stroke-width="1.5" />
        <polyline fill="none" stroke="${cobalt}" stroke-width="2.5" points="${pts1}" />
        <polyline fill="none" stroke="${azure}" stroke-width="2.2" stroke-dasharray="6 4" points="${pts2}" />
        <text x="90" y="102" font-family="JetBrains Mono, monospace" font-size="12" fill="${cobalt}">— PE(pos, 2i) = sin(pos / 10000^(2i/d))</text>
        <text x="90" y="122" font-family="JetBrains Mono, monospace" font-size="12" fill="${azure}">-- PE(pos, 2i+1) = cos(pos / 10000^(2i/d))</text>
        <rect x="90" y="280" width="540" height="62" rx="8" fill="#F8FAFC" stroke="${border}" stroke-width="1.5" />
        <text x="360" y="307" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${slate}">X_input = TokenEmbedding(X) + PositionalEncoding</text>
        <text x="360" y="328" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="12" fill="${muted}">순환 구조(RNN) 없이도 토큰의 절대 위치 및 상대 거리 선형 변환 표현 가능</text>
      `;
      break;
    }

    case 'transformer-architecture': {
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">Transformer Encoder–Decoder 아키텍처 핵심 블록</text>
        <!-- Encoder -->
        <rect x="65" y="85" width="260" height="260" rx="10" fill="#F8FAFC" stroke="${cobalt}" stroke-width="1.8" />
        <text x="195" y="110" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="14" font-weight="700" fill="${cobalt}">Encoder × N</text>
        <rect x="90" y="265" width="210" height="44" rx="6" fill="${cobaltLight}" stroke="${cobalt}" stroke-width="1.5" />
        <text x="195" y="292" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="12" font-weight="600" fill="${slate}">Multi-Head Self-Attention</text>
        <rect x="90" y="205" width="210" height="36" rx="6" fill="#FFFFFF" stroke="${border}" stroke-width="1.5" />
        <text x="195" y="228" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${muted}">Add &amp; LayerNorm</text>
        <rect x="90" y="135" width="210" height="46" rx="6" fill="${azureLight}" stroke="${azure}" stroke-width="1.5" />
        <text x="195" y="163" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="12" font-weight="600" fill="${slate}">Position-wise FFN</text>

        <!-- Cross Arrow -->
        <path d="M 325 160 L 390 160 L 390 220 L 421 220" fill="none" stroke="${cobalt}" stroke-width="2" marker-end="url(#arrow-cobalt)" />
        <text x="362" y="148" font-family="JetBrains Mono, monospace" font-size="11" font-weight="700" fill="${cobalt}">K, V</text>

        <!-- Decoder -->
        <rect x="425" y="85" width="245" height="260" rx="10" fill="#F8FAFC" stroke="${indigo}" stroke-width="1.8" />
        <text x="547" y="110" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="14" font-weight="700" fill="${indigo}">Decoder × N</text>
        <rect x="445" y="275" width="205" height="40" rx="6" fill="${indigoLight}" stroke="${indigo}" stroke-width="1.5" />
        <text x="547" y="300" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="12" font-weight="600" fill="${slate}">Masked Self-Attention</text>
        <rect x="445" y="205" width="205" height="42" rx="6" fill="${cobaltLight}" stroke="${cobalt}" stroke-width="1.5" />
        <text x="547" y="230" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="12" font-weight="600" fill="${slate}">Cross-Attention (Q←Dec)</text>
        <rect x="445" y="135" width="205" height="42" rx="6" fill="${azureLight}" stroke="${azure}" stroke-width="1.5" />
        <text x="547" y="160" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="12" font-weight="600" fill="${slate}">FFN + Add &amp; Norm</text>
      `;
      break;
    }

    case 'pipeline-overview': {
      const steps = [
        { title: '1. Input & PosEnc', sub: '토큰 임베딩 + 위치', color: azure, fill: azureLight },
        { title: '2. Q/K/V Attention', sub: '문맥 유사도 계산', color: cobalt, fill: cobaltLight },
        { title: '3. FFN & Residual', sub: '비선형 표현 강화', color: indigo, fill: indigoLight },
        { title: '4. Linear & Softmax', sub: '다음 토큰 확률 예측', color: slate, fill: '#F8FAFC' },
      ];
      body = `
        <text x="36" y="42" font-family="Plus Jakarta Sans, sans-serif" font-size="16" font-weight="700" fill="${slate}">전체 처리 파이프라인 요약 (End-to-End Flow)</text>
        ${steps
          .map((s, idx) => {
            const x = 42 + idx * 165;
            return `
            <rect x="${x}" y="145" width="136" height="92" rx="8" fill="${s.fill}" stroke="${s.color}" stroke-width="1.8" />
            <text x="${x + 68}" y="182" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="13" font-weight="700" fill="${s.color}">${s.title}</text>
            <text x="${x + 68}" y="206" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="11" fill="${muted}">${s.sub}</text>
            ${idx < 3 ? `<line x1="${x + 136}" y1="191" x2="${x + 161}" y2="191" stroke="${slate}" stroke-width="1.8" marker-end="url(#arrow)" />` : ''}
          `;
          })
          .join('')}
        <text x="360" y="295" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${muted}">Complexity per layer: Self-Attention O(N²·d) vs. RNN O(N·d²) · 병렬 연산 가능</text>
      `;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    ${arrowDefs}
    <rect width="${width}" height="${height}" rx="12" fill="${bg}" stroke="${border}" stroke-width="1.5" />
    ${body}
  </svg>`;
}

export async function renderDiagramToPngDataUrl(preset: DiagramPreset): Promise<string | null> {
  if (preset === 'none') return null;
  const svgMarkup = buildDiagramSvgMarkup(preset, 960, 540);
  if (!svgMarkup) return null;

  return new Promise((resolve) => {
    const img = new Image();
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 540;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve(pngUrl);
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

interface DiagramCanvasProps {
  preset: DiagramPreset;
  caption?: string;
}

export function DiagramCanvas({ preset, caption }: DiagramCanvasProps) {
  if (preset === 'none') return null;
  const svg = buildDiagramSvgMarkup(preset, 720, 380);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div
        className="w-full overflow-hidden rounded"
        // Internally generated deterministic SVG template
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {caption && (
        <p className="mt-2 text-xs text-slate-500 leading-relaxed">
          {caption}
        </p>
      )}
    </div>
  );
}
