export type BacksoundCode =
  | 'B00' | 'B01' | 'B02' | 'B03' | 'B04' | 'B05' | 'B06' | 'B07' | 'B08'
  | 'B09' | 'B10' | 'B11' | 'B12' | 'B13' | 'B14' | 'B15' | 'B16' | 'B17'
  | 'B18' | 'B19' | 'B20' | 'B21' | 'B22' | 'B23' | 'B24'
  | 'B25' | 'B26' | 'B27' | 'B28' | 'B29' | 'B30' | 'B31' | 'B32'
  | 'B33' | 'B34' | 'B35' | 'B36' | 'B37' | 'B38' | 'B39'
  | 'M01' | 'M02' | 'M03' | 'M04' | 'M05' | 'M06' | 'M07' | 'M08'
  | 'M09' | 'M10' | 'M11' | 'M12' | 'M13' | 'M14' | 'M15' | 'M16'
  | 'M17' | 'M18' | 'M19' | 'M20' | 'M21' | 'M22' | 'M23' | 'M24';

export type SfxPackCode =
  | 'S-UMUM'
  | 'S-KERTAS'
  | 'S-DIGITAL'
  | 'S-MEKANIK'
  | 'S-ANALOG'
  | 'S-ARCADE'
  | 'S-ORGANIK'
  | 'S-JALANAN'
  | 'S-SINEMA'
  | 'S-KOMIK';

export type CameraModePreset =
  | 'calm-steady'
  | 'push-in-settle'
  | 'dolly-lateral-parallax'
  | 'orbit-3d-inspect'
  | 'crane-up-focus'
  | 'follow-target-rack'
  | 'pull-out-monumental';

export type TransitionTypePreset =
  | 'none'
  | 'color-flood'
  | 'whip-pan'
  | 'zoom-through'
  | 'diagonal-wipe'
  | 'shutter-slats'
  | 'iris-mask'
  | 'glitch-slice'
  | 'paper-tear';

export type BackgroundPatternType =
  | 'none'
  | 'editorial-grid'
  | 'topographic-contours'
  | 'halftone-dots'
  | 'paper-grain'
  | 'isometric-axon'
  | 'blueprint-draft'
  | 'crt-scanlines'
  | 'diagonal-construct';

export interface MotionStylePreset {
  id: number;
  slug: string;
  name: string;
  suitableFor: string[];
  palette: {
    bg: string;
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    accentSecondary: string;
  };
  typography: {
    heading: string;
    body: string;
    mono: string;
    headingWeight: number;
    uppercaseHeading: boolean;
  };
  shape: {
    borderRadius: number;
    strokeWidth: number;
    hardShadow: boolean;
    shadowOffset: number;
    quantizedFps?: number; // 8 or 12 for stop-motion/doodle styles, undefined for full 30/60fps
    hudFrame: boolean;
    bgPattern: BackgroundPatternType;
  };
  motion: {
    bpm: number;
    springPreset: 'editorialSettle' | 'brutalSlap' | 'playfulPop' | 'criticalLock' | 'mechanicalClack';
    defaultTransition: TransitionTypePreset;
    sceneCameraCycle: CameraModePreset[];
  };
  audio: {
    backsound: BacksoundCode;
    altBacksound: BacksoundCode[];
    primarySfxPack: SfxPackCode;
    secondarySfxPack: SfxPackCode;
  };
  avoid: string;
}

type RawStyleTuple = [
  number,
  string,
  string,
  [string, string, string, string, string, string],
  [string, string, string, number, number],
  [BackgroundPatternType, number, number, number, number, number, number],
  [number, MotionStylePreset["motion"]["springPreset"], TransitionTypePreset, CameraModePreset],
  [BacksoundCode, SfxPackCode, SfxPackCode]
];

const RAW_STYLES: RawStyleTuple[] = [
  [1,"cyberpunk","Cyberpunk",["#0B0B10","#141722","#F5F6FA","#7A869A","#F2E900","#FF2A3D"],["Chakra Petch","Share Tech Mono","Share Tech Mono",700,1],["none",0,2,1,4,1,0],[102,"criticalLock","none","push-in-settle"],["B03","S-DIGITAL","S-SINEMA"]],
  [2,"doodle","Doodle",["#F6F0E1","#FFFDF7","#1F3A93","#6C7A9C","#FFD23F","#E4572E"],["Gochi Hand","Patrick Hand","DM Mono",400,0],["paper-grain",12,3,1,3,0,12],[112,"playfulPop","iris-mask","calm-steady"],["B01","S-KERTAS","S-ORGANIK"]],
  [3,"zine-fotokopi","Zine Fotokopi",["#EFECE6","#F8F4EA","#111111","#555555","#FF4F9A","#C6F500"],["Anton","Special Elite","Space Mono",400,1],["halftone-dots",0,3,1,6,0,12],[92,"brutalSlap","paper-tear","push-in-settle"],["B05","S-KERTAS","S-JALANAN"]],
  [4,"grafiti","Grafiti",["#2B2D2F","#7A3B2E","#F8F9FA","#8A8D8F","#FF3B1F","#FFE400"],["Sedgwick Ave Display","Permanent Marker","Space Mono",400,1],["halftone-dots",4,4,1,6,0,0],[90,"brutalSlap","whip-pan","dolly-lateral-parallax"],["B05","S-JALANAN","S-UMUM"]],
  [5,"topografi","Topografi",["#EFE8D6","#E4DBC4","#2F5D50","#7B4B2A","#D1432B","#3E7CB1"],["EB Garamond","DM Mono","DM Mono",600,0],["topographic-contours",2,1.5,0,0,0,0],[70,"editorialSettle","iris-mask","dolly-lateral-parallax"],["B10","S-KERTAS","S-UMUM"]],
  [6,"memphis","Memphis",["#F8F4E3","#FFFFFF","#1B1B1B","#5A5A5A","#FF5CA8","#00B8A9"],["Bowlby One","Fredoka","Space Mono",400,1],["halftone-dots",16,3,1,6,0,0],[110,"playfulPop","color-flood","calm-steady"],["B07","S-ORGANIK","S-UMUM"]],
  [7,"isometric","Isometric",["#F4EFE6","#FFFFFF","#3D348B","#6B658B","#FF6B35","#2EC4B6"],["IBM Plex Sans Condensed","IBM Plex Sans","IBM Plex Mono",700,1],["isometric-axon",4,2,1,5,0,0],[120,"editorialSettle","diagonal-wipe","dolly-lateral-parallax"],["B09","S-DIGITAL","S-MEKANIK"]],
  [8,"clay-3d","Clay 3D",["#F7EDE2","#FFF9F2","#2D232E","#7A6C7B","#FF8FA3","#FFC857"],["Baloo 2","Fredoka","DM Mono",800,0],["none",28,0,0,0,0,12],[114,"playfulPop","iris-mask","orbit-3d-inspect"],["B08","S-ORGANIK","S-UMUM"]],
  [9,"comic-book","Comic Book",["#FFF8E7","#FFFFFF","#111111","#4A4A4A","#E4002B","#FFDE00"],["Bangers","Comic Neue","Space Mono",400,1],["halftone-dots",0,4,1,7,0,0],[156,"brutalSlap","whip-pan","push-in-settle"],["B22","S-KOMIK","S-UMUM"]],
  [10,"split-flap","Split Flap",["#111111","#1B1B1B","#F5F1E6","#7A766E","#F2A900","#2EC4B6"],["Barlow Condensed","DM Mono","DM Mono",700,1],["none",4,2,1,4,0,0],[108,"mechanicalClack","none","calm-steady"],["B24","S-MEKANIK","S-DIGITAL"]],
  [11,"neo-brutalism","Neo-Brutalism",["#FFDE59","#FFFFFF","#111111","#333333","#FF6B6B","#7DF9AA"],["Archivo Black","Space Mono","Space Mono",400,1],["none",0,4,1,8,0,0],[122,"brutalSlap","color-flood","calm-steady"],["B09","S-DIGITAL","S-KERTAS"]],
  [12,"swiss-internasional","Swiss Internasional",["#F4F4F0","#EAEAE4","#111111","#767670","#E10600","#111111"],["Hanken Grotesk","Hanken Grotesk","IBM Plex Mono",800,0],["none",0,1.5,0,0,0,0],[106,"criticalLock","none","calm-steady"],["B21","S-DIGITAL","S-UMUM"]],
  [13,"bauhaus-konstruktivis","Bauhaus dan Konstruktivis",["#EFE6D2","#F5EBD8","#141414","#5C5649","#D7261E","#F2B705"],["Bebas Neue","Jost","DM Mono",400,1],["none",0,3,1,6,0,0],[104,"brutalSlap","diagonal-wipe","calm-steady"],["B23","S-MEKANIK","S-SINEMA"]],
  [14,"risograph","Risograph",["#F5F0E4","#FFFDF8","#0078BF","#00A95C","#FF48B0","#FFE800"],["Fraunces","Space Mono","Space Mono",800,0],["halftone-dots",2,2,1,4,0,0],[86,"editorialSettle","paper-tear","calm-steady"],["B01","S-KERTAS","S-UMUM"]],
  [15,"vhs-analog","VHS Analog",["#0A0A0A","#1B253B","#E8E1D0","#8E8878","#E01E2D","#2B4A8B"],["VT323","IBM Plex Mono","VT323",400,1],["crt-scanlines",6,2,0,0,0,0],[108,"mechanicalClack","none","push-in-settle"],["B02","S-ANALOG","S-UMUM"]],
  [16,"y2k-kromium","Y2K Kromium",["#0D0D12","#191D28","#F5F8FF","#8F9BB3","#A8D8FF","#E8143C"],["Unbounded","Space Grotesk","DM Mono",800,1],["none",20,2,1,4,0,0],[124,"playfulPop","zoom-through","orbit-3d-inspect"],["B04","S-DIGITAL","S-UMUM"]],
  [17,"pixel-art-8bit","Pixel Art 8-Bit",["#1A1C2C","#333C57","#F4F4F4","#94B0C2","#FFCD75","#38B764"],["Press Start 2P","Pixelify Sans","Press Start 2P",400,1],["none",0,4,1,4,0,12],[140,"mechanicalClack","none","calm-steady"],["B13","S-ARCADE","S-DIGITAL"]],
  [18,"blueprint","Blueprint",["#1A4E8A","#123A6B","#EAF2FF","#8EB4E3","#FFD60A","#FF6B35"],["IBM Plex Mono","Architects Daughter","IBM Plex Mono",700,1],["blueprint-draft",0,1.5,0,0,1,0],[96,"criticalLock","none","calm-steady"],["B10","S-MEKANIK","S-KERTAS"]],
  [19,"papercut-berlapis","Papercut Berlapis",["#F6EBD9","#FFF8EE","#264653","#5C7680","#E76F51","#2A9D8F"],["Bricolage Grotesque","Fredoka","DM Mono",800,0],["paper-grain",10,0,1,6,0,12],[108,"playfulPop","paper-tear","push-in-settle"],["B08","S-KERTAS","S-ORGANIK"]],
  [20,"collage-scrapbook","Collage Scrapbook",["#C8A27A","#F1E8D6","#151515","#5A4A3A","#C1272D","#2B4A8B"],["Playfair Display","Special Elite","Special Elite",700,0],["paper-grain",2,2,1,5,0,12],[88,"brutalSlap","paper-tear","dolly-lateral-parallax"],["B19","S-KERTAS","S-UMUM"]],
  [21,"mid-century-70an","Mid-Century 70-an",["#F2E8D5","#FFF8EA","#4A2C1A","#6B7A3A","#D4572A","#E1A730"],["Shrikhand","DM Serif Display","DM Mono",700,0],["paper-grain",24,2,1,5,0,0],[96,"editorialSettle","iris-mask","push-in-settle"],["B16","S-KERTAS","S-MEKANIK"]],
  [22,"art-deco","Art Deco",["#0E0E0E","#0F5C4D","#EFE3C8","#9A8C6C","#C9A227","#EFE3C8"],["Poiret One","Cinzel","DM Mono",400,1],["none",0,2,0,0,0,0],[112,"editorialSettle","none","push-in-settle"],["B14","S-MEKANIK","S-SINEMA"]],
  [23,"ukiyo-e","Ukiyo-e",["#F0E6D0","#E5D8BC","#1A1A1A","#5A5244","#D9381E","#1D3F6B"],["Zen Antique","Shippori Mincho","DM Mono",400,0],["paper-grain",0,3,0,0,0,0],[84,"editorialSettle","iris-mask","dolly-lateral-parallax"],["B23","S-KERTAS","S-ORGANIK"]],
  [24,"nusantara","Nusantara (Batik, Wayang, Arabesque)",["#EADBB8","#1E2A4A","#1F1A14","#6B3F1D","#C79A3B","#1F4D3A"],["Lora","Lora","DM Mono",700,0],["paper-grain",4,2,0,0,0,0],[76,"editorialSettle","iris-mask","dolly-lateral-parallax"],["B17","S-KERTAS","S-ORGANIK"]],
  [25,"koran-editorial","Koran Editorial",["#E9E4D4","#DFD9C6","#1A1A1A","#5A574F","#B3261E","#1A1A1A"],["Playfair Display","Old Standard TT","Libre Franklin",800,0],["none",0,1.5,0,0,0,0],[104,"criticalLock","none","calm-steady"],["B14","S-MEKANIK","S-KERTAS"]],
  [26,"terminal-cli","Terminal CLI",["#0A0F0A","#111A11","#E8F0E0","#5E7A5E","#33FF66","#FFB000"],["JetBrains Mono","IBM Plex Mono","JetBrains Mono",700,0],["none",4,1.5,1,4,0,0],[120,"criticalLock","none","calm-steady"],["B09","S-DIGITAL","S-MEKANIK"]],
  [27,"wireframe-lowpoly-3d","Wireframe dan Low-Poly 3D",["#0C1015","#141B24","#E8EEF2","#6C7D8C","#FF7A1A","#38BDF8"],["Space Mono","IBM Plex Mono","IBM Plex Mono",700,1],["none",0,1.5,0,0,0,0],[120,"editorialSettle","none","orbit-3d-inspect"],["B09","S-DIGITAL","S-UMUM"]],
  [28,"glitch","Glitch",["#000000","#121212","#FFFFFF","#7A7A7A","#FF0033","#1E5BFF"],["Rubik Mono One","Share Tech Mono","Share Tech Mono",400,1],["none",0,2,1,5,0,0],[126,"brutalSlap","none","calm-steady"],["B04","S-DIGITAL","S-ANALOG"]],
  [29,"neon-signage","Neon Signage",["#121014","#1D1922","#FFE9C7","#786E82","#FF3D6E","#6EE7FF"],["Tilt Neon","Space Grotesk","DM Mono",400,1],["none",12,3,0,0,0,0],[108,"editorialSettle","none","push-in-settle"],["B02","S-ANALOG","S-UMUM"]],
  [30,"papan-tulis-kapur","Papan Tulis Kapur",["#2B3A37","#222F2C","#F1F1E8","#9AB0AA","#F6D365","#F28DA6"],["Schoolbell","Kalam","DM Mono",400,0],["paper-grain",6,2.5,0,0,0,0],[92,"editorialSettle","diagonal-wipe","calm-steady"],["B19","S-ORGANIK","S-KERTAS"]],
  [31,"film-noir","Film Noir",["#0A0A0A","#1C1C1C","#F2F0EB","#7A7873","#B3171E","#FFFFFF"],["Bodoni Moda","Libre Franklin","IBM Plex Mono",800,1],["none",0,1.5,1,10,0,0],[78,"editorialSettle","none","push-in-settle"],["B11","S-SINEMA","S-UMUM"]],
  [32,"retro-futurism","Retro-Futurism",["#F4E3C1","#F8EDD5","#1F4E5F","#697A7E","#E85D2A","#F2B134"],["Righteous","Michroma","DM Mono",400,1],["none",30,2.5,1,5,0,0],[102,"editorialSettle","iris-mask","push-in-settle"],["B16","S-DIGITAL","S-MEKANIK"]],
  [33,"woodcut-engraving","Woodcut dan Engraving",["#EFE3C6","#E2D3B0","#2A1E14","#6E5A48","#9E2A2B","#2A1E14"],["IM Fell English","Cormorant","IBM Plex Mono",400,0],["paper-grain",0,2,0,0,0,0],[84,"editorialSettle","paper-tear","push-in-settle"],["B19","S-KERTAS","S-UMUM"]],
  [34,"rubber-hose-1930s","Rubber Hose 1930-an",["#F2E8D0","#FFF8E6","#3A2A1A","#7A6855","#C8382C","#E1A730"],["Rye","Bowlby One SC","Special Elite",400,1],["paper-grain",24,3.5,1,4,0,12],[106,"playfulPop","iris-mask","calm-steady"],["B15","S-KOMIK","S-ORGANIK"]],
  [35,"manga","Manga",["#FFFFFF","#FAFAFA","#111111","#555555","#E4002B","#111111"],["Dela Gothic One","Zen Kaku Gothic New","Space Mono",400,1],["none",0,4,1,6,0,0],[160,"brutalSlap","none","push-in-settle"],["B22","S-KOMIK","S-SINEMA"]],
  [36,"data-editorial","Data Editorial",["#FAF8F3","#F0EDE4","#1F1F1F","#8C8C84","#D1432B","#2F6F8F"],["Source Serif 4","Source Sans 3","IBM Plex Mono",700,0],["none",2,1.5,0,0,0,0],[104,"criticalLock","none","calm-steady"],["B21","S-DIGITAL","S-UMUM"]],
  [37,"inflatable-3d","Inflatable 3D",["#FFF4E6","#FFFFFF","#1D1D2C","#6E6E85","#FF4D6D","#00C2A8"],["Fredoka","Baloo 2","DM Mono",800,0],["none",32,0,0,0,0,0],[112,"playfulPop","color-flood","orbit-3d-inspect"],["B07","S-ORGANIK","S-UMUM"]],
  [38,"peta-transit","Peta Transit",["#F6F4EE","#FFFFFF","#1A1A1A","#757570","#E63946","#1D8FE1"],["Barlow Condensed","Barlow","IBM Plex Mono",700,1],["none",16,4,0,0,0,0],[116,"editorialSettle","diagonal-wipe","dolly-lateral-parallax"],["B24","S-MEKANIK","S-DIGITAL"]],
  [39,"hud-game","HUD Game",["#0B1118","#14202E","#F2F6F8","#6E859E","#00D1B2","#FFB800"],["Rajdhani","Teko","Share Tech Mono",700,1],["none",2,2,0,0,1,0],[132,"criticalLock","none","calm-steady"],["B03","S-DIGITAL","S-ARCADE"]],
  [40,"siaran-olahraga","Siaran Olahraga",["#0A0A0A","#18181B","#FFFFFF","#9CA3AF","#FFD400","#E4002B"],["Teko","Barlow Condensed","IBM Plex Mono",800,1],["none",0,3,1,6,1,0],[150,"brutalSlap","none","calm-steady"],["B22","S-SINEMA","S-UMUM"]],
  [41,"cat-air","Cat Air",["#FBF7F0","#F3ECE0","#2F3E46","#6A8CAF","#E7A5A5","#A8C69F"],["Cormorant","Patrick Hand","DM Mono",600,0],["paper-grain",18,1.5,0,0,0,0],[68,"editorialSettle","iris-mask","dolly-lateral-parallax"],["B10","S-ORGANIK","S-UMUM"]],
  [42,"krayon-pastel","Krayon dan Pastel Minyak",["#FFF9EC","#FFFFFF","#1D3557","#457B9D","#E63946","#FFD166"],["Gochi Hand","Patrick Hand","DM Mono",400,0],["paper-grain",16,4,1,4,0,10],[114,"playfulPop","paper-tear","calm-steady"],["B08","S-KERTAS","S-ORGANIK"]],
  [43,"motion-reel-editorial","Motion Reel Editorial",["#F4EEE7","#FFFFFF","#0F110F","#686662","#FD5837","#C9DE4B"],["Instrument Serif","Hanken Grotesk","JetBrains Mono",400,0],["none",12,1.5,0,0,0,0],[122,"editorialSettle","none","push-in-settle"],["B09","S-DIGITAL","S-MEKANIK"]],
  [44,"apple-inspired-product-cinema","Apple-Inspired Interactive Motion",["#0D0E10","#1B1D21","#F5F5F7","#A5A7AE","#8DB8FF","#E8C9AB"],["Inter","Inter","monospace",650,0],["none",0,1,0,0,0,0],[116,"criticalLock","none","calm-steady"],["B25","S-SINEMA","S-MEKANIK"]],
];

export const STYLES_CATALOG: Record<number, MotionStylePreset> = Object.fromEntries(
  RAW_STYLES.map(([id, slug, name, p, ty, sh, mo, au]) => [
    id,
    {
      id,
      slug,
      name,
      suitableFor: [],
      palette: { bg: p[0], surface: p[1], ink: p[2], muted: p[3], accent: p[4], accentSecondary: p[5] },
      typography: { heading: ty[0], body: ty[1], mono: ty[2], headingWeight: ty[3], uppercaseHeading: Boolean(ty[4]) },
      shape: {
        bgPattern: sh[0],
        borderRadius: sh[1],
        strokeWidth: sh[2],
        hardShadow: Boolean(sh[3]),
        shadowOffset: sh[4],
        hudFrame: Boolean(sh[5]),
        ...(sh[6] ? { quantizedFps: sh[6] } : {}),
      },
      motion: {
        bpm: mo[0],
        springPreset: mo[1],
        defaultTransition: mo[2],
        sceneCameraCycle: [mo[3]],
      },
      audio: { backsound: au[0], altBacksound: [], primarySfxPack: au[1], secondarySfxPack: au[2] },
      avoid: "",
    },
  ])
);

export function getStyleById(id: number): MotionStylePreset {
  return STYLES_CATALOG[id] || STYLES_CATALOG[43];
}

export function getStyleBySlug(slug: string): MotionStylePreset {
  const found = Object.values(STYLES_CATALOG).find(
    (s) => s.slug.toLowerCase() === slug.toLowerCase() || s.name.toLowerCase() === slug.toLowerCase()
  );
  return found || STYLES_CATALOG[43];
}
