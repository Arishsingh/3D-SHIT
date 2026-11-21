// ============================================================ your portfolio
// Every door in the corridor loop inside the house opens into one of these rooms.
// The first entry is the door nearest the front door (to your left as you come in);
// the rest follow round the loop. Up to 14 rooms.
//
//   style     which room it is (see src/roomThemes.js): study workroom workshop plans reception hallway, plus decoys: bedroom bathroom storage trapdoor
//   door      text on the prompt when you stand at the door ("ENTER  ABOUT")
//   title     big heading on the far wall of the room
//   subtitle  smaller line under it
//   boards    up to 4 framed notices on the side walls: { title, body, link? }
//             a board with a link opens it in a new tab when you look at it and press Enter
//
//
// The doors are listed in walking order round the loop. Decoy doors (no title, no boards) are plain rooms to wander into.

export const PORTFOLIO = [
  {
    door: 'INTRODUCTION', style: 'study', title: 'ARISH SINGH', subtitle: 'Automation & Full Stack Developer',
    boards: [
      { title: 'Hello', body: 'I build scalable backends, automation and clean, modern interfaces. I learn by building things from scratch, breaking them and shipping again.' },
      { title: 'Now', body: 'Automation and Full Stack Developer at Neurix.dev (remote). Also Marketing Head at Cyber Unbound, Bangalore.' },
      { title: 'Proof', body: '$3K+ earned freelancing over the last 6 months. A creative developer who never stops moving.' },
      { title: 'Website', body: 'The full portfolio, blog and resume.', link: 'https://arishsingh.site' },
    ],
  },
  { door: 'OPEN DOOR', style: 'bedroom' },
  {
    door: 'PROJECTS', style: 'workroom', title: 'PROJECTS', subtitle: 'Things I have built',
    boards: [
      { title: 'Croma', body: 'Chrome extension that explains selected code, catches console errors and watches slow API calls. JavaScript, AI.', link: 'https://croma-nine.vercel.app' },
      { title: 'Immortal', body: 'Horror survival game about being watched. No checkpoints, no second chances. React, Vite.', link: 'https://immortal-game.vercel.app/' },
      { title: 'Neurix Studio', body: 'Software and the story around it: web, mobile and automation. Three.js, WebGL.', link: 'https://www.neurixstudio.in' },
      { title: 'Ariena', body: 'Studio platform for original games, films and short stories. Next.js, TypeScript.', link: 'https://ariena.vercel.app/' },
    ],
  },
  { door: 'OPEN DOOR', style: 'bathroom' },
  {
    door: 'SKILLS', style: 'workshop', title: 'SKILLS', subtitle: 'What I work with',
    boards: [
      { title: 'Languages', body: 'JavaScript, TypeScript, Python, Java, Go, HTML and CSS.' },
      { title: 'Frontend', body: 'React, Next.js, Tailwind, shadcn/ui, Redux, Three.js, WebGL, Vite.' },
      { title: 'Backend & data', body: 'Node.js, Express, FastAPI, PostgreSQL, MongoDB, MySQL, Redis, Supabase, Prisma.' },
      { title: 'Automation & cloud', body: 'n8n, OpenAI, Docker, Kubernetes, AWS, Vercel, GitHub Actions.' },
    ],
  },
  { door: 'OPEN DOOR', style: 'storage' },
  {
    door: 'UPCOMING PLANS', style: 'plans', title: 'UPCOMING PLANS',
    boards: [
      { title: 'ECLIPSE Protocol', body: 'The next thing from Ariena. Coming soon.', link: 'https://ariena.vercel.app/' },
      { title: 'More worlds', body: 'Original games, films and short stories under Ariena.' },
      { title: 'Keep shipping', body: 'More AI dev tools and automation, in the spirit of Croma, Velocity and Nexa.' },
      { title: 'Writing', body: 'More write-ups on how each project is built.', link: 'https://dev.to/arishsingh99' },
    ],
  },
  { door: 'OPEN DOOR', style: 'trapdoor' },
  {
    door: 'CONTACTS', style: 'reception', title: 'CONTACTS', subtitle: 'Say hello',
    // shown as wooden signposts standing in the room (look at one, press Enter)
    signs: [
      { label: 'GITHUB', sub: 'Arishsingh', link: 'https://github.com/Arishsingh' },
      { label: 'LINKEDIN', sub: 'in/arishsingh', link: 'https://www.linkedin.com/in/arishsingh/' },
      { label: 'MESSAGE', sub: 'arishsingh9469@gmail.com', link: 'mailto:arishsingh9469@gmail.com' },
      { label: 'X', sub: '@itz_Arishsingh', link: 'https://x.com/itz_Arishsingh' },
    ],
  },
  {
    door: 'BYE', style: 'hallway', title: 'BYE', subtitle: 'Thanks for visiting',
    boards: [
      { title: 'See you', body: 'Thanks for walking through. Come back any time, the doors stay open.', link: 'https://arishsingh.site' },
    ],
  },
];
