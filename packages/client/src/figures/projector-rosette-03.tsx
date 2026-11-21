// Projector Rosette 03 figure definition: an expressive linocut kinetic wheel with six sweeping outer tread blades,
// eccentrically offset engraved five-aperture wheel face, graduated minute-mark mask, and concentric central hub.
import type { HomeFigure } from "../home-figure.tsx"
import type { SoundProfile } from "../home-sound.ts"

// Crisp kinetic wheel identity (Fmaj9 / F Lydian pentatonic: F4, G4, A4, C5, D5, E5, F5, G5, A5)
const SOUND: SoundProfile = {
  scale: [349.23, 392.0, 440.0, 523.25, 587.33, 659.25, 698.46, 783.99, 880.0],
  motif: [0, 2, 3, 4, 6, 4, 3, 1, 2, 4, 7, 5],
  wave: "sine",
  overtone: { ratio: 3, level: 0.11, decayRatio: 0.32 },
  tap: { startHz: 380, endHz: 155, level: 0.25 },
  filter: { baseHz: 2850, rangeHz: 700 },
  echo: { delaySec: 0.24, feedback: 0.2, wet: 0.22 },
  decay: { base: 0.42, accent: 0.62 },
  accents: {
    beats: [0, 4, 8],
    irisOpen: 8,
    irisClose: 2,
    hover: [4, 7],
    click: 6,
    engage: [0, 3],
  },
}

const ExtraHairline = () => (
  <>
    {/* Eccentric kinetic orbit ring around the inner wheel hub (577, 483) */}
    <circle cx="577" cy="483" r="362" class="hl-belt pr3-wheel-orbit" stroke-dasharray="5 9" />
    {/* Eccentricity callout marking the offset between outer tread center (512, 508) and wheel center (577, 483) */}
    <g class="hl-callout pr-detail-fine">
      <path d="M512 508L577 483 M882 292L970 240 M158 758L74 808" />
      <circle cx="512" cy="508" r="3.2" />
      <circle cx="577" cy="483" r="3.2" />
      <circle cx="973" cy="238" r="3" />
      <circle cx="71" cy="810" r="3" />
    </g>
  </>
)

const Artwork = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="home-emblem"
    data-brand="projector-rosette-03"
    viewBox="0 0 1021 1024"
    aria-hidden="true"
  >
    <defs>
      <path id="pr3-minor-tick" d="M577 177L577 197" />
      <g id="pr3-minute-marks" stroke="#000" stroke-width="2.3">
        <use href="#pr3-minor-tick" />
        <use href="#pr3-minor-tick" transform="rotate(4 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(8 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(12 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(16 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(20 577 483)" class="pr-detail-micro" />
        <path d="M577 175L577 205" stroke-width="3.6" transform="rotate(24 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(28 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(32 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(36 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(40 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(44 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(48 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(52 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(56 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(60 577 483)" class="pr-detail-micro" />
        <path d="M857 342L829 356" stroke-width="3.6" />
        <use href="#pr3-minor-tick" transform="rotate(68 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(72 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(76 577 483)" class="pr-detail-micro" />
        <use href="#pr3-minor-tick" transform="rotate(80 577 483)" />
        <use href="#pr3-minor-tick" transform="rotate(84 577 483)" class="pr-detail-micro" />
      </g>
      <mask id="pr3-wheel-engraving-mask" maskUnits="userSpaceOnUse" x="240" y="140" width="690" height="680">
        <rect x="240" y="140" width="690" height="680" fill="#fff" />
        <g fill="none" stroke="#000">
          <ellipse cx="581" cy="480" rx="324" ry="318" stroke-width="9" />
          <ellipse cx="577" cy="483" rx="270" ry="263" stroke-width="8" />
          <ellipse cx="577" cy="484" rx="255" ry="253" stroke-width="5" />
        </g>
        <g fill="#000">
          <path d="M362 365C395 381 443 375 468 351C495 326 505 286 492 247C449 262 398 307 362 365Z" />
          <path d="M645 242C631 286 643 328 674 348C693 360 703 350 720 340C750 320 781 341 784 369C788 379 797 373 803 366C771 308 714 261 645 242Z" />
          <path d="M324 485C367 487 401 515 411 548C422 584 405 622 374 641C342 600 324 544 324 485Z" />
          <path d="M829 486C789 485 759 508 744 538C728 574 743 618 773 639C807 596 827 544 829 486Z" />
          <path d="M494 716C499 671 531 642 571 641C614 638 649 670 657 717C604 740 545 740 494 716Z" />
        </g>
        <g fill="none" stroke="#000" stroke-linecap="round">
          <path d="M500 245C515 291 505 330 475 358C444 387 399 394 361 380" stroke-width="3" />
          <path
            d="M508 244C525 291 510 339 475 368C444 393 396 403 364 389"
            stroke-width="2.4"
            class="pr-detail-fine"
          />
          <path d="M634 241C617 291 635 340 668 353C690 363 703 357 718 347" stroke-width="3" />
          <path d="M628 242C612 292 629 336 659 351C678 361 695 361 708 354" stroke-width="2" class="pr-detail-fine" />
          <path d="M326 478C367 477 408 504 422 543C440 589 417 631 387 647" stroke-width="3" />
          <path d="M328 470C372 468 416 503 430 542C446 588 423 635 392 650" stroke-width="2" class="pr-detail-fine" />
          <path d="M828 479C779 479 744 511 731 545C717 585 735 630 766 647" stroke-width="3" />
          <path d="M827 472C780 469 736 505 722 546C706 592 731 635 762 650" stroke-width="2" class="pr-detail-fine" />
          <path d="M487 714C490 669 527 630 571 628C620 626 656 664 664 714" stroke-width="3" />
          <path
            d="M479 703C485 658 524 622 568 622C619 618 661 651 672 700"
            stroke-width="2.4"
            class="pr-detail-fine"
          />
          <path d="M693 484C693 446 704 413 732 409C758 407 778 395 783 379" stroke-width="3" />
          <path d="M778 395C790 392 801 387 809 381" stroke-width="1.6" class="pr-detail-fine" />
          <path
            d="M325 476L333 477M325 482L333 483M819 476L829 476M818 482L829 482M789 380L807 373M785 387L810 379"
            stroke-width="1.2"
            class="pr-detail-micro"
          />
        </g>
        <g id="pr3-hub-rings" fill="none" stroke="#000">
          <ellipse cx="576" cy="487" rx="119" ry="116" stroke-width="4" />
          <ellipse cx="575" cy="487" rx="112" ry="109" stroke-width="3" class="pr-detail-fine" />
          <ellipse cx="576" cy="487" rx="104" ry="101" stroke-width="3" />
          <ellipse cx="575" cy="488" rx="96" ry="94" stroke-width="2.5" class="pr-detail-fine" />
          <ellipse cx="576" cy="487" rx="89" ry="86" stroke-width="2" />
          <ellipse cx="575" cy="487" rx="82" ry="79" stroke-width="2" class="pr-detail-micro" />
          <ellipse cx="576" cy="487" rx="74" ry="71" stroke-width="2" />
          <ellipse cx="575" cy="487" rx="64" ry="63" stroke-width="4" />
          <ellipse cx="575" cy="487" rx="36" ry="35" stroke-width="6" />
          <ellipse cx="746" cy="370" rx="30" ry="29" stroke-width="3" />
          <circle cx="575" cy="487" r="21" fill="#000" stroke="none" />
          <ellipse cx="746" cy="370" rx="18" ry="18" fill="#000" stroke="none" />
        </g>
        <g class="pr-detail-micro" fill="none" stroke="#000" stroke-width="1.4">
          <path d="M477 429C451 474 464 532 492 558C521 585 556 594 590 591" />
          <path d="M642 409C672 434 690 479 675 520C662 558 632 578 605 586" />
          <path d="M480 475C474 508 489 541 514 558M495 479C493 506 505 530 524 542" />
        </g>
        <g id="pr3-dial-marks">
          <use href="#pr3-minute-marks" />
          <use href="#pr3-minute-marks" transform="rotate(90 577 483)" />
          <use href="#pr3-minute-marks" transform="rotate(180 577 483)" />
          <use href="#pr3-minute-marks" transform="rotate(270 577 483)" />
        </g>
        <g fill="#000">
          <path d="M572 175H579V215H572Z" />
          <path d="M859 479H890V486H859Z" />
          <path d="M573 750H580V790H573Z" />
          <path d="M262 479H295V486H262Z" />
        </g>
        <g fill="#fff">
          <path d="M566 208H586V220H566Z" />
          <path d="M567 741H587V753H567Z" />
        </g>
        <g fill="#000">
          <path d="M572 175H579V215H572Z" />
          <path d="M573 750H580V790H573Z" />
        </g>
      </mask>
    </defs>

    <g id="swept-tire-tread" fill="#000">
      <path
        id="upper-swept-blade"
        d="M221 149C259 112 279 98 316 78C386 40 448 26 514 25C579 21 646 30 706 39C620 40 550 69 488 108C411 93 314 103 221 149Z"
      />
      <path
        id="upper-left-blade"
        d="M41 499C49 411 78 315 130 246C180 180 216 155 273 135C341 111 414 107 487 110C432 148 384 189 344 235C332 248 323 258 314 268C195 306 100 383 41 499Z"
      />
      <path
        id="left-middle-blade"
        d="M43 536C66 449 170 331 310 274C265 343 246 403 243 482C204 552 174 635 164 703C153 767 166 816 189 854C101 770 49 655 43 536Z"
      />
      <path
        id="lower-left-blade"
        d="M243 491C213 554 190 625 178 693C168 751 176 813 207 861C242 913 299 943 356 963C423 986 488 993 563 987C450 950 364 848 319 695C267 637 243 567 243 491Z"
      />
      <path
        id="bottom-swept-blade"
        d="M326 702C351 785 398 867 459 918C506 958 560 984 601 977C690 962 776 913 835 849C778 881 682 871 562 813C472 806 388 768 326 702Z"
      />
      <path
        id="lower-right-blade"
        d="M573 813C661 810 735 789 797 758C879 720 939 666 980 604C958 689 918 771 841 836C805 869 696 869 573 813Z"
      />
    </g>

    <g id="wheel-and-hub" fill="#000">
      <path
        id="outer-wheel-body"
        d="M349 250C409 185 490 147 575 146C665 144 751 177 815 237C880 298 920 385 922 474C924 570 887 658 824 718C784 757 735 784 676 798C746 777 808 735 850 677C891 620 913 551 912 482C909 385 871 301 807 245C743 187 664 157 579 157C493 158 413 191 349 250Z"
      />
      <path
        id="engraved-wheel-face"
        d="M916 481C916 659 767 804 579 804C394 804 249 661 249 484C249 307 397 151 579 151C765 151 916 299 916 481Z"
        mask="url(#pr3-wheel-engraving-mask)"
      />
    </g>
  </svg>
)

export const projectorRosette03: HomeFigure = {
  id: "projector-rosette-03",
  shape: "square",
  idleSpeed: 6.2,
  detentDeg: 8,
  sound: SOUND,
  frame: {
    viewBox: "-190 -162 1400 1348",
    cx: 512,
    cy: 508,
    r: 522,
    outerR: 578,
    cornerX: 590,
    cornerY: 570,
    axisX: [548, 622],
    axisY: [548, 618],
  },
  ExtraHairline,
  Artwork,
  createRig: (svg, hairline) => {
    const wheel = svg.querySelector<SVGGElement>("#wheel-and-hub")
    const tread = svg.querySelector<SVGGElement>("#swept-tire-tread")
    const dialMarks = svg.querySelector<SVGGElement>("#pr3-dial-marks")
    const hubRings = svg.querySelector<SVGGElement>("#pr3-hub-rings")
    const wheelOrbit = hairline.querySelector<SVGCircleElement>(".pr3-wheel-orbit")

    return {
      apply: (s, dirty) => {
        if (wheel) wheel.setAttribute("transform", `rotate(${s.theta.toFixed(2)} 577 483)`)

        if (dialMarks && dirty("dial", s.dial, 0.03)) {
          dialMarks.setAttribute("transform", `rotate(${(-s.dial * 0.9).toFixed(2)} 577 483)`)
        }

        const treadFlex = s.iris + s.vel * 0.008
        if (tread && dirty("tread", treadFlex, 0.002)) {
          const rot = -treadFlex * 5.2
          const sc = 1 + s.iris * 0.02
          tread.setAttribute(
            "transform",
            `translate(512 508) rotate(${rot.toFixed(2)}) scale(${sc.toFixed(4)}) translate(-512 -508)`,
          )
        }

        if (hubRings && dirty("iris", s.iris, 0.002)) {
          const sc = 1 + s.iris * 0.024
          hubRings.setAttribute("transform", `translate(576 487) scale(${sc.toFixed(4)}) translate(-576 -487)`)
        }

        const dash = (s.theta * 2.1) % 42
        if (wheelOrbit && dirty("dash", dash, 0.15)) {
          wheelOrbit.style.strokeDashoffset = (-dash).toFixed(1)
        }
      },
    }
  },
}
