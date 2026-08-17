import type { Config } from 'tailwindcss';

/* ══════════════════════════════════════════════════════════════════════════
   SALA DE PROJEÇÃO — the design system.

   A dark auditorium, not a piece of equipment. The image arrives as light
   thrown through celluloid, so the palette is the one film itself is made of:
   three-strip Technicolor dye — red, cyan, cream — over the blue-black of a
   room with the house lights down. Nothing here is a neon accent on grey; the
   colour comes from the medium.
   ══════════════════════════════════════════════════════════════════════════ */

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // the room
        house: {
          DEFAULT: '#07090e', // the auditorium with the lights down
          deep: '#04050a',    // the screen surround, deeper than the room
          seat: '#0e121b',    // a raised surface: panels, rows, the slate
          rail: '#18202e',    // edges and dividers
        },
        // the beam: tungsten through film, warm at the core
        beam: {
          DEFAULT: '#ffe9c4',
          hot: '#fff6e6',
          dim: '#8d8574',
        },
        /* Technicolor dye. Red has two jobs and they need two values: a dye
           bright enough to read as text on the dark room is too bright to put
           cream lettering on top of, and the commit key is the most-pressed
           control in the product. `red` fills surfaces (cream on it: 4.8:1);
           `red-lit` is red used AS text (5.5:1 on a plate). Using the wrong one
           is how the primary button ended up at 4.14:1. */
        dye: {
          red: '#d12a20',      // fills: the commit key, the REC lamp, the curtain
          'red-lit': '#f2564a', // red as text: links, destructive hover
          'red-deep': '#8c1e18',
          cyan: '#43b8c6',     // state, selection, the cool half of the frame
          'cyan-deep': '#1d5f68',
          /* Green belongs here more than it looks like it should. Three-strip
             Technicolor separates an image onto three records — red, green and
             blue — and the room was already using two of them; this is the one
             that was missing, not a success colour borrowed from somewhere
             else. It has one job: saying that something was written. Red says
             the opposite, and the confirmation of a saved rating was wearing it.

             Two values for the same reason red has two: `green` fills and
             marks (the lamp, the tint, the ring), `green-lit` is green used AS
             text, where it reads 9.9:1 on a plate. */
          green: '#2f9e44',
          'green-lit': '#5fd48a',
        },
        ink: {
          DEFAULT: '#eae4d8',  // text on the room
          dim: '#9d9686',      // 5.4:1 on house — the floor for real text
          faint: '#5b564c',    // perforations, ticks, unlit cells. Never text.
        },
      },
      fontFamily: {
        /* Staatliches is the title card: condensed capitals with the weight and
           the hard corners of a screen-printed poster — the voice of a marquee,
           with more of an accent than the face it replaces.

           It is narrow, and that is a requirement and not a preference. This
           name is not only on the page titles: it is on every button label,
           every chip, every tab and every small tracked caption in the room,
           and all of those sit in boxes sized against a condensed face. Cinzel
           was tried here first — Roman capitals, the most literal answer to
           "make it look like cinema" — and being wide made the display type
           the widest thing on every screen it appeared on. The lesson is that
           this line cannot be changed alone: a display face comes with the
           whole scale, or it comes with a rewrite of it. */
        display: ['Staatliches', '"Bebas Neue"', 'system-ui', 'sans-serif'],
        /* Poppins carries every label, control and paragraph. Geometric and
           round where the display face is condensed and hard, which is the
           contrast a title card wants against the copy under it.

           One thing it does not bring is a tabular figure set: `.q` asks for
           `font-variant-numeric: tabular-nums` so the scores line up in a
           column, and Poppins has no `tnum` feature for the browser to switch
           on. Its digits are near enough to the same width that the columns
           still read, and the request is left in place — it costs nothing and
           it starts working the day the family ships one. */
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        cell: '2px',   // a film cell is square
        plate: '6px',
      },
      transitionTimingFunction: {
        beam: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'frame-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'beam-in': {
          from: { opacity: '0', transform: 'scale(0.985) translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '48%': { opacity: '0.86' },
          '52%': { opacity: '1' },
        },
      },
      animation: {
        'frame-in': 'frame-in 320ms cubic-bezier(0.16,1,0.3,1) backwards',
        'beam-in': 'beam-in 260ms cubic-bezier(0.16,1,0.3,1)',
        flicker: 'flicker 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
