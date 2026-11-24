// Projector Rosette 02 figure definition: a 3/4-perspective studio chronometer housing with coupled main
// four-bladed rotor and lower four-spoke gear spinning in perspective-true elliptical planes, calibrated dial,
// recessed guilloche drum, and knurled winding crowns.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

// Coupled gear ratio derived from rotor & lower wheel radii (2.43 / 1.45)
const LOWER_GEAR_RATIO = -2.43 / 1.45

// Heavy cast-iron studio chronometer: wide pawl double-click, warm iron escapement, stately A4 bronze lock
const SOUND: SoundProfile = {
  escapement: { freq: 1880, q: 2.2, decay: 0.0115, gap: 0.0092, asymmetry: 0.93, level: 0.32 },
  spring: { freq: 2180, q: 11, decay: 0.038, level: 0.08 },
  shutter: { blades: 2, spread: 0.024, openHz: 2150, closeHz: 1520, q: 2.2, decay: 0.028, level: 0.25 },
  engage: { latchGap: 0.064, bellHz: 440, overtoneRatio: 1.5, ringHz: 2260, decay: 0.38, level: 0.17 },
  filter: { baseHz: 2900, rangeHz: 750 },
  room: { delaySec: 0.046, feedback: 0.17, wet: 0.15 },
}

const ExtraHairline = () => (
  <>
    {/* Coupled twin-rotor perspective pitch ellipses */}
    <ellipse
      cx="613"
      cy="397"
      rx="262"
      ry="230"
      transform="rotate(35 613 397)"
      class="hl-belt pr2-main-orbit"
      stroke-dasharray="4 8"
    />
    <ellipse
      cx="388"
      cy="542"
      rx="164"
      ry="149"
      transform="rotate(34 388 542)"
      class="hl-belt pr2-sub-orbit"
      stroke-dasharray="3 7"
    />
    {/* Twin-axis alignment line and crown callouts */}
    <g class="hl-callout pr-detail-fine">
      <path d="M262 624L756 305" stroke-dasharray="2 6" />
      <circle cx="258" cy="626" r="3" />
      <circle cx="760" cy="303" r="3" />
      <path d="M862 106L942 54 M910 764L988 812" />
      <circle cx="945" cy="52" r="3" />
      <circle cx="991" cy="814" r="3" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="projector-rosette-02"
    viewBox="0 0 1024 964"
    aria-hidden="true"
  >
    <defs>
      <pattern
        id="pr2-fine-diagonal-engraving"
        width="5"
        height="5"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(34)"
      >
        <rect width="5" height="5" fill="#fff" />
        <path d="M0 0V5M2.5 0V5" fill="none" stroke="#111" stroke-width=".85" />
      </pattern>
      <pattern
        id="pr2-close-oblique-lines"
        width="4"
        height="4"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(-57)"
      >
        <rect width="4" height="4" fill="#fff" />
        <path d="M0 0V4" stroke="#000" stroke-width="1.5" />
      </pattern>
      <pattern id="pr2-knurled-metal" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(39)">
        <rect width="6" height="6" fill="#080808" />
        <path d="M1 0V6M3.5 0V6" stroke="#fff" stroke-width="1" />
      </pattern>
      <radialGradient id="pr2-hub-metal" cx=".37" cy=".27" r=".77">
        <stop offset="0" stop-color="#fff" />
        <stop offset=".42" stop-color="#fff" />
        <stop offset=".59" stop-color="#a4a4a4" />
        <stop offset=".66" stop-color="#fff" />
        <stop offset=".79" stop-color="#626262" />
        <stop offset=".86" stop-color="#e5e5e5" />
        <stop offset="1" stop-color="#050505" />
      </radialGradient>
      <linearGradient id="pr2-shaft-metal" x1="0" y1="0" x2="1" y2=".6">
        <stop stop-color="#000" />
        <stop offset=".29" stop-color="#5a5a5a" />
        <stop offset=".47" stop-color="#fff" />
        <stop offset=".57" stop-color="#d3d3d3" />
        <stop offset=".8" stop-color="#242424" />
        <stop offset="1" stop-color="#000" />
      </linearGradient>
      <linearGradient id="pr2-bezel-glints" x1="0" y1=".25" x2="1" y2=".6">
        <stop stop-color="#fff" />
        <stop offset=".21" stop-color="#fff" />
        <stop offset=".275" stop-color="#333" />
        <stop offset=".32" stop-color="#fff" />
        <stop offset=".48" stop-color="#fff" />
        <stop offset=".59" stop-color="#222" />
        <stop offset=".65" stop-color="#fff" />
        <stop offset=".82" stop-color="#fff" />
        <stop offset=".87" stop-color="#555" />
        <stop offset="1" stop-color="#fff" />
      </linearGradient>
      <linearGradient id="pr2-wheel-glints" x1=".12" y1="0" x2=".85" y2="1">
        <stop stop-color="#fff" />
        <stop offset=".28" stop-color="#fff" />
        <stop offset=".4" stop-color="#333" />
        <stop offset=".49" stop-color="#fff" />
        <stop offset=".7" stop-color="#fff" />
        <stop offset=".83" stop-color="#777" />
        <stop offset="1" stop-color="#fff" />
      </linearGradient>
      <mask id="pr2-bezel-line-shine">
        <rect x="-420" y="-440" width="840" height="880" fill="url(#pr2-bezel-glints)" />
      </mask>
      <mask id="pr2-wheel-line-shine">
        <rect x="340" y="150" width="530" height="520" fill="url(#pr2-wheel-glints)" />
      </mask>
      {/* Streamlined concentric guilloche engraving (preserves turned-metal luster without sub-pixel clutter) */}
      <g id="pr2-concentric-engraving" fill="none" stroke="#131313" stroke-width=".55">
        <circle r="98" />
        <circle r="92" class="pr-detail-micro" />
        <circle r="86" />
        <circle r="80" class="pr-detail-micro" />
        <circle r="74" />
        <circle r="68" class="pr-detail-micro" />
        <circle r="62" />
        <circle r="56" class="pr-detail-micro" />
        <circle r="50" />
        <circle r="44" class="pr-detail-micro" />
        <circle r="38" />
        <circle r="32" class="pr-detail-micro" />
        <circle r="26" />
        <circle r="20" class="pr-detail-micro" />
        <circle r="14" />
        <circle r="8" class="pr-detail-micro" />
      </g>
      <g id="pr2-outer-ring-lines" fill="none" stroke="#111" stroke-width="1.35">
        <ellipse rx="371" ry="408" />
        <ellipse rx="366" ry="403" class="pr-detail-fine" />
        <ellipse rx="361" ry="398" />
        <ellipse rx="356" ry="393" class="pr-detail-fine" />
        <ellipse rx="351" ry="388" />
        <ellipse rx="346" ry="383" class="pr-detail-fine" />
        <ellipse rx="341" ry="378" />
        <ellipse rx="335" ry="372" class="pr-detail-fine" />
      </g>
      <g id="pr2-small-tick" stroke="#141414" fill="none">
        <path d="M0-345V-328" stroke-width="1.5" />
      </g>
      <g id="pr2-medium-tick" stroke="#070707" fill="none">
        <path d="M0-345V-318" stroke-width="2.1" />
      </g>
      <g id="pr2-large-tick" stroke="#000" fill="none">
        <path d="M0-345V-307" stroke-width="5" />
      </g>
      <g id="pr2-tick-sector">
        <use href="#pr2-large-tick" />
        <use href="#pr2-small-tick" transform="rotate(2)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(4)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(6)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(8)" class="pr-detail-micro" />
        <use href="#pr2-medium-tick" transform="rotate(10)" />
        <use href="#pr2-small-tick" transform="rotate(12)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(14)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(16)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(18)" class="pr-detail-micro" />
        <use href="#pr2-medium-tick" transform="rotate(20)" />
        <use href="#pr2-small-tick" transform="rotate(22)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(24)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(26)" class="pr-detail-micro" />
        <use href="#pr2-small-tick" transform="rotate(28)" class="pr-detail-micro" />
      </g>
      <g id="pr2-slotted-screw">
        <ellipse rx="21" ry="22" fill="#fff" stroke="#000" stroke-width="2" />
        <ellipse rx="16.7" ry="18" fill="#000" />
        <path d="M-10-13C-20-2-13 14 1 16M-5-15C8-19 17-8 15 5" fill="none" stroke="#fff" stroke-width="1.6" />
        <path d="M-15-5L15 4 14 9-16 0Z" fill="#d2d2d2" stroke="#fff" stroke-width="1" />
        <path d="M-15-3L14 6" stroke="#000" stroke-width="2" />
        <path d="M-9 11Q0 18 10 10" fill="none" stroke="#999" stroke-width="1" />
      </g>
      <clipPath id="pr2-lower-case-clip">
        <path d="M319 108C235 149 184 210 145 280C127 313 70 325 46 357C24 385 27 427 47 452L92 494C112 513 120 528 128 565C163 736 286 871 446 910C606 949 786 874 879 747C962 633 974 451 915 311C818 81 525 8 319 108Z" />
      </clipPath>
      <clipPath id="pr2-main-wheel-clip">
        <path d="M568 181C687 173 803 259 841 373C882 494 820 604 721 630C611 660 466 600 399 488C334 381 350 256 439 204C476 183 522 176 568 181Z" />
      </clipPath>
      <clipPath id="pr2-small-wheel-clip">
        <path d="M310 407C385 378 483 425 522 503C562 584 525 655 457 680C379 706 291 663 254 588C217 509 237 439 310 407Z" />
      </clipPath>
    </defs>

    <g id="mounting-lugs" stroke="#080808" stroke-linejoin="round">
      <path
        d="M142 282C122 310 70 324 47 355C26 380 27 423 45 448C67 475 105 491 125 542L171 574 211 330Z"
        fill="#030303"
        stroke-width="3"
      />
      <path
        d="M140 301C122 326 78 330 58 363C39 396 55 439 81 460L128 498C118 448 118 373 140 301Z"
        fill="url(#pr2-close-oblique-lines)"
        stroke-width="2"
      />
      <path d="M49 366C26 393 34 425 52 445" fill="none" stroke="#eee" stroke-width="2" />
      <ellipse
        cx="95"
        cy="399"
        rx="22"
        ry="26"
        transform="rotate(-27 95 399)"
        fill="#000"
        stroke="#fff"
        stroke-width="3"
      />
      <path d="M77 397C86 387 104 400 104 413C96 428 75 413 77 397Z" fill="#fff" stroke-width="1" />
      <path
        d="M928 477C955 496 981 536 980 577C981 607 962 624 939 639L902 668 884 594Z"
        fill="#050505"
        stroke-width="3"
      />
      <path
        d="M945 499C966 520 978 553 976 579C975 604 961 620 935 630L913 632 927 592Z"
        fill="url(#pr2-close-oblique-lines)"
        stroke-width="2"
      />
      <ellipse
        cx="944"
        cy="582"
        rx="19"
        ry="24"
        transform="rotate(22 944 582)"
        fill="#000"
        stroke="#fff"
        stroke-width="2"
      />
      <path d="M934 581Q948 584 945 601Q932 602 929 594Z" fill="#fff" stroke="none" />
    </g>

    <g id="upper-winding-crown" stroke="#080808">
      <path
        d="M767 123L790 98C805 83 832 100 848 122C859 137 866 153 856 163L835 183Z"
        fill="url(#pr2-knurled-metal)"
        stroke-width="3"
      />
      <path d="M774 118C795 100 842 135 841 172L829 185 765 137Z" fill="#000" stroke-width="2" />
      <path
        d="M779 121C798 115 833 145 834 169M781 126C800 121 827 149 828 171"
        fill="none"
        stroke="#eee"
        stroke-width="1.6"
      />
      <path d="M796 97C819 94 850 128 855 148" fill="none" stroke="#fff" stroke-width="2" />
    </g>
    <g id="lower-winding-crown" stroke="#000">
      <path d="M858 699L904 727C908 735 876 785 856 797L819 774Z" fill="#050505" stroke-width="3" />
      <path d="M873 714L900 730C897 746 877 773 858 788L840 775Z" fill="url(#pr2-knurled-metal)" stroke-width="2" />
      <path d="M851 782Q881 761 896 730L876 718" fill="none" stroke="#fff" stroke-width="1.5" />
    </g>

    <g id="deep-engraved-case">
      <path
        d="M319 108C235 149 184 210 145 280C127 313 126 398 121 448C115 611 210 786 347 868C485 951 670 931 797 825C945 705 988 500 915 311C818 81 525 8 319 108Z"
        fill="#050505"
        stroke="#000"
        stroke-width="3"
      />
      <g clip-path="url(#pr2-lower-case-clip)" fill="none" stroke="#e6e6e6" stroke-width="1.5">
        <ellipse cx="531" cy="471" rx="405" ry="441" transform="rotate(-20 531 471)" />
        <ellipse cx="535" cy="463" rx="405" ry="441" transform="rotate(-20 535 463)" class="pr-detail-micro" />
        <ellipse cx="539" cy="455" rx="405" ry="441" transform="rotate(-20 539 455)" />
        <ellipse cx="543" cy="447" rx="405" ry="441" transform="rotate(-20 543 447)" class="pr-detail-micro" />
        <ellipse cx="547" cy="439" rx="405" ry="441" transform="rotate(-20 547 439)" />
        <ellipse cx="551" cy="431" rx="405" ry="441" transform="rotate(-20 551 431)" class="pr-detail-micro" />
        <ellipse cx="555" cy="423" rx="405" ry="441" transform="rotate(-20 555 423)" />
        <ellipse cx="559" cy="415" rx="405" ry="441" transform="rotate(-20 559 415)" class="pr-detail-micro" />
        <ellipse cx="563" cy="407" rx="405" ry="441" transform="rotate(-20 563 407)" />
        <ellipse cx="567" cy="399" rx="405" ry="441" transform="rotate(-20 567 399)" class="pr-detail-micro" />
      </g>
      <path d="M159 659C176 698 193 727 217 754L284 705 228 605Z" fill="#000" />
      <path d="M369 821L332 866C374 892 431 910 470 916L518 862Z" fill="#000" />
      <g class="pr-detail-fine" fill="none" stroke="#b6b6b6" stroke-width="1.2">
        <path d="M218 758L254 724M230 773L270 739M245 788L286 752M262 803L304 767M280 818L322 781M299 833L340 795M318 845L357 807" />
        <path d="M340 854L378 824M357 861L394 831M377 870L412 840" />
      </g>
    </g>

    <g id="front-bezel" transform="translate(554 454) rotate(-20)">
      <ellipse rx="383" ry="416" fill="#fff" stroke="#070707" stroke-width="3" />
      <ellipse rx="377" ry="409" fill="#fff" stroke="#000" stroke-width="2.5" />
      <g mask="url(#pr2-bezel-line-shine)">
        <use href="#pr2-outer-ring-lines" />
      </g>
      <path d="M-131-383L-110-391-100-344-117-338Z" fill="#fff" opacity=".93" />
      <path d="M122 336L146 329 156 378 129 388Z" fill="#fff" opacity=".9" />
      <path d="M-371-70L-333-64-333-35-374-35Z" fill="#fff" opacity=".94" />
      <ellipse rx="329" ry="362" fill="#fff" stroke="#000" stroke-width="3" />
      <ellipse rx="282" ry="315" fill="#020202" stroke="#111" stroke-width="2" />
    </g>

    <g id="bezel-engraving-soft-highlights" class="pr-detail-fine" fill="none" stroke="#fff" opacity=".62">
      <path d="M418 77L438 118M426 74L446 115" stroke-width="3.2" />
      <path d="M650 801L661 846M661 798L672 842M671 795L682 838" stroke-width="3.2" />
      <path d="M174 396L207 401M172 405L206 410" stroke-width="3.2" />
    </g>

    <g id="calibrated-dial" transform="translate(554 454) rotate(-20)">
      <g transform="scale(.967 1.025)">
        <g id="calibrated-dial-ticks" transform="rotate(18)">
          <use href="#pr2-tick-sector" />
          <use href="#pr2-tick-sector" transform="rotate(30)" />
          <use href="#pr2-tick-sector" transform="rotate(60)" />
          <use href="#pr2-tick-sector" transform="rotate(90)" />
          <use href="#pr2-tick-sector" transform="rotate(120)" />
          <use href="#pr2-tick-sector" transform="rotate(150)" />
          <use href="#pr2-tick-sector" transform="rotate(180)" />
          <use href="#pr2-tick-sector" transform="rotate(210)" />
          <use href="#pr2-tick-sector" transform="rotate(240)" />
          <use href="#pr2-tick-sector" transform="rotate(270)" />
          <use href="#pr2-tick-sector" transform="rotate(300)" />
          <use href="#pr2-tick-sector" transform="rotate(330)" />
        </g>
      </g>
    </g>

    <g id="recessed-mechanism">
      <path
        d="M274 398C294 252 417 163 553 166C712 164 835 281 850 430C869 567 778 701 643 721C487 746 343 647 288 525Z"
        fill="#000"
      />
      <path
        d="M306 397C318 277 428 188 557 184C700 184 822 287 838 420C857 547 770 667 639 686C499 705 364 620 322 504Z"
        fill="#fff"
        stroke="#000"
        stroke-width="2"
      />
      <g class="pr-detail-fine" transform="translate(574 437) rotate(-17) scale(2.68 2.49)">
        <use href="#pr2-concentric-engraving" />
      </g>
      <path d="M309 399C315 346 342 290 375 266L364 396Z" fill="#000" />
      <path d="M472 676C562 719 714 695 784 629C735 705 620 735 491 708Z" fill="#000" />
      <g class="pr-detail-micro" fill="none" stroke="#eee" stroke-width="1.1">
        <path d="M534 709C625 733 720 690 767 653M553 718C630 736 703 706 749 670" />
      </g>
      <path d="M235 375L286 386 274 405 231 394Z" fill="#151515" />
      <path d="M239 378L281 390M237 383L277 395" stroke="#aaa" stroke-width="1" />
    </g>

    <g id="lower-four-spoke-wheel">
      <path
        d="M304 419C376 387 481 428 523 509C567 592 530 668 461 691C381 718 287 672 250 594C215 518 235 450 304 419Z"
        fill="#000"
        stroke="#050505"
        stroke-width="3"
      />
      <path
        d="M310 407C385 378 483 425 522 503C562 584 525 655 457 680C379 706 291 663 254 588C217 509 237 439 310 407Z"
        fill="#fff"
        stroke="#000"
        stroke-width="3"
      />
      <g clip-path="url(#pr2-small-wheel-clip)">
        <rect x="220" y="390" width="330" height="300" fill="url(#pr2-fine-diagonal-engraving)" />
        <g class="pr-detail-fine" transform="translate(388 542) rotate(34) scale(1.45 1.32)">
          <use href="#pr2-concentric-engraving" opacity=".48" />
        </g>
        <g id="lower-wheel-cutouts">
          <path
            d="M273 438C295 447 319 472 316 506C315 534 295 554 262 561C241 516 247 469 273 438Z"
            fill="#000"
            stroke="#fff"
            stroke-width="4"
          />
          <path
            d="M298 614C322 591 350 582 377 597C405 612 419 643 417 677C372 676 326 654 298 614Z"
            fill="#000"
            stroke="#fff"
            stroke-width="4"
          />
          <path
            d="M474 654C454 632 439 609 448 583C457 558 484 546 526 548C534 592 512 633 474 654Z"
            fill="#000"
            stroke="#fff"
            stroke-width="4"
          />
          <path
            d="M309 414C325 439 360 447 388 438L417 412C377 393 337 396 309 414Z"
            fill="#000"
            stroke="#fff"
            stroke-width="3"
          />
        </g>
        <path
          d="M257 468C235 526 265 605 314 643M273 454C241 502 258 575 290 613M308 646C350 675 395 685 443 678"
          fill="none"
          stroke="#fff"
          stroke-width="2"
        />
      </g>
      <path
        d="M310 407C385 378 483 425 522 503C562 584 525 655 457 680C379 706 291 663 254 588C217 509 237 439 310 407Z"
        fill="none"
        stroke="#000"
        stroke-width="2"
      />
      <g id="lower-wheel-bearing" transform="translate(382 525) rotate(-25)">
        <ellipse cy="5" rx="36" ry="37" fill="#000" />
        <ellipse rx="34" ry="35" fill="url(#pr2-hub-metal)" stroke="#000" stroke-width="2" />
        <ellipse cy="-2" rx="29" ry="30" fill="none" stroke="#fff" stroke-width="2" />
        <ellipse cy="-3" rx="26" ry="27" fill="none" stroke="#222" stroke-width="1.2" class="pr-detail-fine" />
        <ellipse cy="-6" rx="20" ry="21" fill="#fff" stroke="#111" stroke-width="2" />
        <ellipse cy="-7" rx="16" ry="17" fill="url(#pr2-hub-metal)" stroke="#000" stroke-width="1" />
        <path d="M-11-18C-18-8-11 7 2 8C14 9 17-3 9-12" fill="none" stroke="#111" stroke-width="1" />
        <path d="M-25 19Q-4 37 19 23" fill="none" stroke="#fff" stroke-width="1.5" />
      </g>
    </g>

    <g id="large-four-bladed-rotor">
      <path
        d="M565 185C690 178 810 269 848 384C887 507 823 617 723 644C608 674 462 612 397 499C331 386 350 260 437 210C477 189 522 181 565 185Z"
        fill="#000"
        stroke="#000"
        stroke-width="3"
      />
      <path
        d="M568 181C687 173 803 259 841 373C882 494 820 604 721 630C611 660 466 600 399 488C334 381 350 256 439 204C476 183 522 176 568 181Z"
        fill="#fff"
        stroke="#000"
        stroke-width="3"
      />
      <g clip-path="url(#pr2-main-wheel-clip)">
        <g mask="url(#pr2-wheel-line-shine)">
          <g class="pr-detail-fine" transform="translate(613 397) rotate(35) scale(2.43 2.14)">
            <use href="#pr2-concentric-engraving" />
          </g>
          <g class="pr-detail-fine" fill="none" stroke="#111" stroke-width="1.3">
            <path d="M566 185C680 179 796 263 834 374C876 493 814 598 717 623C611 650 472 593 407 484C344 380 359 260 445 210C480 190 522 182 566 185Z" />
            <path d="M566 193C675 188 787 270 824 378C865 490 807 589 714 614C610 640 479 587 417 480C355 381 369 266 451 219C485 199 525 191 566 193Z" />
          </g>
        </g>
        <g id="rotor-cutouts" fill="#000" stroke="#fff" stroke-width="4" stroke-linejoin="round">
          <path d="M566 188C533 181 500 195 490 222C474 271 504 326 568 354L579 340C537 294 545 236 568 196Z" />
          <path d="M635 335C653 292 713 270 780 296C796 316 810 341 817 361L810 365C758 327 706 324 660 354Z" />
          <path d="M660 414C715 432 755 483 766 528C772 562 738 594 677 602L671 599C703 542 699 488 657 439Z" />
          <path d="M439 438C492 457 539 444 576 418L606 435C588 486 537 507 482 501C465 485 449 461 439 438Z" />
        </g>
        <g class="pr-detail-fine" fill="none" stroke="#fff" stroke-width="1.8" opacity=".8">
          <path d="M458 244C411 282 400 354 424 411" />
          <path d="M450 247C403 284 392 350 415 408" />
          <path d="M694 271C721 276 742 285 757 294" />
          <path d="M736 444C752 478 762 512 757 538" />
        </g>
      </g>
      <path
        d="M568 181C687 173 803 259 841 373C882 494 820 604 721 630C611 660 466 600 399 488C334 381 350 256 439 204C476 183 522 176 568 181Z"
        fill="none"
        stroke="#000"
        stroke-width="2.6"
      />
      <path
        class="pr-detail-fine"
        d="M555 166C663 160 769 222 824 316M556 172C660 168 763 227 817 320"
        fill="none"
        stroke="#ddd"
        stroke-width="1.7"
      />
      <path d="M439 205C393 235 370 275 368 331C362 374 377 427 399 468" fill="none" stroke="#eee" stroke-width="2" />
    </g>

    <g id="rotor-central-spindle" transform="translate(617 385) rotate(-27)">
      <ellipse cy="8" rx="56" ry="56" fill="#000" />
      <ellipse cx="1" cy="2" rx="54" ry="55" fill="url(#pr2-hub-metal)" stroke="#000" stroke-width="2.4" />
      <ellipse cy="0" rx="49.5" ry="50" fill="none" stroke="#f9f9f9" stroke-width="2" />
      <ellipse cy="-2" rx="45.5" ry="46" fill="none" stroke="#111" stroke-width="1.3" class="pr-detail-fine" />
      <ellipse cy="-3" rx="42" ry="42.5" fill="none" stroke="#fff" stroke-width="1.8" />
      <ellipse cy="-5" rx="38" ry="38.5" fill="none" stroke="#111" stroke-width="1.1" class="pr-detail-micro" />
      <ellipse cy="-6" rx="34.5" ry="35" fill="#f8f8f8" stroke="#111" stroke-width="1.3" />
      <ellipse cy="-6" rx="29.5" ry="30" fill="none" stroke="#222" stroke-width="1.1" class="pr-detail-fine" />
      <ellipse cy="-6" rx="24.5" ry="25" fill="none" stroke="#333" stroke-width="1" class="pr-detail-micro" />
      <ellipse cx="3" cy="-4" rx="18.5" ry="19" fill="#000" stroke="#aaa" stroke-width="1.3" />
      <ellipse cx="4" cy="-4" rx="15.5" ry="16" fill="#000" stroke="#eee" stroke-width=".8" />
      <path d="M-7-16C2-23 15-12 16-2" fill="none" stroke="#d0d0d0" stroke-width="1.3" />
      <path d="M-32-30C-46-11-37 16-20 24M-28-31C-39-16-36 6-23 18" fill="none" stroke="#fff" stroke-width="2.4" />
      <path d="M12-35L25-27M10-29L21-21" stroke="#fff" stroke-width="2" />
      <path d="M-36 26C-19 44 8 46 30 28" fill="none" stroke="#fff" stroke-width="1.7" />
    </g>

    <g id="offset-connecting-pin">
      <path
        d="M404 394C416 387 439 397 446 411L442 434 418 461C407 473 387 467 378 452C370 440 377 426 384 416Z"
        fill="#000"
        stroke="#000"
        stroke-width="2"
      />
      <path
        d="M398 403L436 427 415 454C405 468 384 456 380 443C378 433 388 418 398 403Z"
        fill="url(#pr2-shaft-metal)"
        stroke="#000"
        stroke-width="2"
      />
      <g class="pr-detail-micro" fill="none" stroke="#141414" stroke-width="1">
        <path d="M386 420Q384 441 416 450M392 412Q390 436 422 442M398 406Q396 429 429 434" />
      </g>
      <g transform="translate(427 413) rotate(-28)">
        <ellipse rx="28" ry="27" fill="url(#pr2-hub-metal)" stroke="#000" stroke-width="2" />
        <ellipse cy="-1" rx="24" ry="23" fill="#fff" stroke="#333" stroke-width="1" />
        <ellipse cy="-1" rx="19" ry="18" fill="none" stroke="#555" stroke-width=".9" class="pr-detail-fine" />
        <ellipse cy="-1" rx="14" ry="13" fill="none" stroke="#777" stroke-width=".9" class="pr-detail-micro" />
        <ellipse cx="2" rx="4" ry="3.7" fill="#fff" stroke="#000" stroke-width="1" />
        <path d="M3-2L1 1 5 2" fill="none" stroke="#000" stroke-width=".8" />
      </g>
    </g>

    <g id="bezel-fasteners">
      <use href="#pr2-slotted-screw" transform="translate(523 76) rotate(60) scale(.9)" />
      <use href="#pr2-slotted-screw" transform="translate(202 359) rotate(7) scale(.94)" />
      <use href="#pr2-slotted-screw" transform="translate(284 679) rotate(13) scale(.95)" />
      <use href="#pr2-slotted-screw" transform="translate(797 763) rotate(14) scale(.93)" />
    </g>

    <g id="edge-finishing-lines" fill="none" stroke-linecap="round">
      <path
        d="M306 119C382 68 473 40 554 45C712 45 853 152 914 309C972 459 951 618 864 743"
        stroke="#000"
        stroke-width="2"
      />
      <path d="M168 393C157 512 203 644 290 733C386 831 520 882 648 850" stroke="#000" stroke-width="2" />
      <path d="M150 286C172 229 209 184 255 150" stroke="#fff" stroke-width="1.7" />
      <path d="M462 911C576 934 696 896 784 831" stroke="#aaa" stroke-width="1" />
    </g>
  </svg>
)

export const projectorRosette02: HomeFigure = {
  id: "projector-rosette-02",
  shape: "square",
  idleSpeed: 4.8,
  detentDeg: 8,
  sound: SOUND,
  frame: {
    viewBox: "-147 -152 1318 1268",
    cx: 536,
    cy: 468,
    r: 516,
    outerR: 566,
    cornerX: 572,
    cornerY: 544,
    axisX: [540, 608],
    axisY: [540, 598],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const rotorCutouts = svg.querySelector<SVGGElement>("#rotor-cutouts")
    const lowerCutouts = svg.querySelector<SVGGElement>("#lower-wheel-cutouts")
    const dialTicks = svg.querySelector<SVGGElement>("#calibrated-dial-ticks")
    const spindle = svg.querySelector<SVGGElement>("#rotor-central-spindle")
    const upperCrown = svg.querySelector<SVGGElement>("#upper-winding-crown")
    const mainOrbit = hairline.querySelector<SVGEllipseElement>(".pr2-main-orbit")
    const subOrbit = hairline.querySelector<SVGEllipseElement>(".pr2-sub-orbit")

    return {
      apply: (s, dirty) => {
        // Perspective-true elliptical rotation for the main four-bladed rotor (tilt 35°, aspect 0.8807)
        if (rotorCutouts) {
          rotorCutouts.setAttribute(
            "transform",
            `translate(613 397) rotate(35) scale(1 0.8807) rotate(${s.theta.toFixed(2)}) scale(1 1.1355) rotate(-35) translate(-613 -397)`,
          )
        }
        // Coupled counter-rotating lower four-spoke wheel (tilt 34°, aspect 0.9103)
        if (lowerCutouts) {
          lowerCutouts.setAttribute(
            "transform",
            `translate(388 542) rotate(34) scale(1 0.9103) rotate(${(s.theta * LOWER_GEAR_RATIO).toFixed(2)}) scale(1 1.0985) rotate(-34) translate(-388 -542)`,
          )
        }
        // Dial ticks live inside the bezel's perspective scale(.967 1.025) group, so pure rotation stays in-plane
        if (dialTicks && dirty("dial", s.dial, 0.03)) {
          dialTicks.setAttribute("transform", `rotate(${(18 + s.dial).toFixed(2)})`)
        }
        // Subtle iris breathing on the central spindle & winding crown
        if (dirty("iris", s.iris, 0.002)) {
          if (spindle) {
            const sc = 1 + s.iris * 0.028
            spindle.setAttribute("transform", `translate(617 385) rotate(-27) scale(${sc.toFixed(4)})`)
          }
          if (upperCrown) {
            const pull = s.iris * 3.5
            upperCrown.setAttribute("transform", `translate(${(pull * 0.7).toFixed(2)} ${(-pull * 0.7).toFixed(2)})`)
          }
        }
        const dash = (s.theta * 2.0) % 36
        if (dirty("dash", dash, 0.15)) {
          if (mainOrbit) mainOrbit.style.strokeDashoffset = dash.toFixed(1)
          if (subOrbit) subOrbit.style.strokeDashoffset = (-dash * 1.4).toFixed(1)
        }
      },
    }
  },
}
