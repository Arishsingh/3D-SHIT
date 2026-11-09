// ============================================================ your portfolio
// Every door in the corridor loop inside the house opens into one of these rooms.
// The first entry is the door nearest the front door (to your left as you come in);
// the rest follow round the loop. Up to 14 rooms.
//
//   door      text on the prompt when you stand at the door ("ENTER  ABOUT")
//   title     big heading on the far wall of the room
//   subtitle  smaller line under it
//   boards    up to 4 framed notices on the side walls: { title, body, link? }
//             a board with a link opens it in a new tab when you look at it and press Enter
//
// Everything below is placeholder text: replace it with your own.
export const PORTFOLIO = [
  {
    door: 'ABOUT', title: 'ABOUT', subtitle: 'arishsingh',
    boards: [
      { title: 'Hello', body: 'Write a short introduction here: who you are, what you make, and what you are looking for.' },
      { title: 'Now', body: 'What you are working on or learning at the moment.' },
      { title: 'Elsewhere', body: 'Your GitHub profile.', link: 'https://github.com/' },
    ],
  },
  {
    door: 'PROJECT 01', title: 'PROJECT 01', subtitle: 'Project name',
    boards: [
      { title: 'What it is', body: 'One or two lines describing the project and the problem it solves.' },
      { title: 'How', body: 'Stack, tools and the interesting technical decisions.' },
      { title: 'Result', body: 'Numbers, users, outcome, or what you learned.' },
      { title: 'Source', body: 'Link to the repository or a live demo.', link: 'https://github.com/' },
    ],
  },
  {
    door: 'PROJECT 02', title: 'PROJECT 02', subtitle: 'Project name',
    boards: [
      { title: 'What it is', body: 'One or two lines describing the project.' },
      { title: 'How', body: 'Stack, tools and the interesting technical decisions.' },
      { title: 'Source', body: 'Link to the repository or a live demo.', link: 'https://github.com/' },
    ],
  },
  {
    door: 'PROJECT 03', title: 'PROJECT 03', subtitle: 'Project name',
    boards: [
      { title: 'What it is', body: 'One or two lines describing the project.' },
      { title: 'How', body: 'Stack, tools and the interesting technical decisions.' },
      { title: 'Source', body: 'Link to the repository or a live demo.', link: 'https://github.com/' },
    ],
  },
  {
    door: 'PROJECT 04', title: 'PROJECT 04', subtitle: 'Project name',
    boards: [
      { title: 'What it is', body: 'One or two lines describing the project.' },
      { title: 'How', body: 'Stack, tools and the interesting technical decisions.' },
      { title: 'Source', body: 'Link to the repository or a live demo.', link: 'https://github.com/' },
    ],
  },
  {
    door: 'SKILLS', title: 'SKILLS', subtitle: 'What I work with',
    boards: [
      { title: 'Languages', body: 'List your languages here.' },
      { title: 'Frameworks', body: 'List frameworks and libraries here.' },
      { title: 'Tools', body: 'Editors, build tools, cloud, design tools.' },
      { title: 'Also', body: 'Anything else you are good at.' },
    ],
  },
  {
    door: 'EXPERIENCE', title: 'EXPERIENCE', subtitle: 'Where I have worked',
    boards: [
      { title: 'Role, Company', body: 'Dates. What you did and what changed because of it.' },
      { title: 'Role, Company', body: 'Dates. What you did and what changed because of it.' },
    ],
  },
  {
    door: 'EDUCATION', title: 'EDUCATION', subtitle: 'Study and courses',
    boards: [
      { title: 'School / University', body: 'Course, years, anything notable.' },
      { title: 'Certificates', body: 'Courses and certifications.' },
    ],
  },
  {
    door: 'ACHIEVEMENTS', title: 'ACHIEVEMENTS', subtitle: 'Awards, talks, wins',
    boards: [
      { title: 'Achievement', body: 'What it was and when.' },
      { title: 'Achievement', body: 'What it was and when.' },
    ],
  },
  {
    door: 'CONTACT', title: 'CONTACT', subtitle: 'Get in touch',
    boards: [
      { title: 'Email', body: 'Your email address.' },
      { title: 'GitHub', body: 'Your GitHub profile.', link: 'https://github.com/' },
      { title: 'LinkedIn', body: 'Your LinkedIn profile.', link: 'https://www.linkedin.com/' },
    ],
  },
];
