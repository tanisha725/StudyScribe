import { render, screen, fireEvent } from '@testing-library/react';
import axios from 'axios';
import App from './App';

jest.mock('axios');

test('shows the sign-in screen when nobody is logged in', () => {
  localStorage.clear();
  render(<App />);
  expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});

test('shows the upload screen after logging in', () => {
  localStorage.setItem('loggedIn', 'true');
  render(<App />);
  expect(screen.getByText(/generate my study set/i)).toBeInTheDocument();
});

test('accepts Word files and no longer offers old PowerPoint files', () => {
  localStorage.setItem('loggedIn', 'true');
  const { container } = render(<App />);
  const accepted = container.querySelector('input[type="file"]').accept.split(',');
  expect(accepted).toContain('.docx');
  expect(accepted).not.toContain('.ppt');
});

test('shows topics, concepts and their sources after an upload', async () => {
  localStorage.setItem('loggedIn', 'true');
  axios.post.mockResolvedValue({
    data: {
      summary: 'A summary.',
      notes: ['A note'],
      flashcards: [],
      quiz: [],
      warnings: [],
      knowledge: {
        topics: [{
          name: 'Trees',
          subtopics: ['Traversal'],
          concepts: [{ name: 'Binary tree', definition: 'At most two children.', example: 'A family tree.', source: 'Page 2' }],
        }],
        relationships: [],
        coverage: { percent: 40, sections: 30, firstSource: 'Page 1', lastSource: 'Page 30' },
      },
    },
  });

  const { container } = render(<App />);
  const file = new File(['content'], 'lecture.pdf', { type: 'application/pdf' });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByText(/generate my study set/i));

  fireEvent.click(await screen.findByText('TOPICS'));
  expect(screen.getByText('Binary tree')).toBeInTheDocument();
  expect(screen.getByText('Page 2')).toBeInTheDocument();
  expect(screen.getByText(/A family tree/)).toBeInTheDocument();
  expect(screen.getByText(/about 40% of your material/)).toBeInTheDocument();
});

test('rejects an unsupported file before uploading', () => {
  localStorage.setItem('loggedIn', 'true');
  axios.post.mockClear();
  const { container } = render(<App />);
  const file = new File(['content'], 'slides.ppt');
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByText(/generate my study set/i));

  expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
});

test('tutor shows an answer with its source and sends the conversation with a follow-up', async () => {
  localStorage.setItem('loggedIn', 'true');
  axios.post.mockReset();
  axios.post.mockResolvedValueOnce({ data: { docId: 'doc-1', summary: 'A summary.', notes: [], flashcards: [], quiz: [], warnings: [], knowledge: null } });

  const { container } = render(<App />);
  const file = new File(['content'], 'lecture.pdf');
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByText(/generate my study set/i));
  fireEvent.click(await screen.findByText('TUTOR'));

  axios.post.mockResolvedValueOnce({
    data: { answer: 'Thrashing is constant page swapping.', found: true, sources: [{ source: 'Page 4', excerpt: 'Thrashing happens when' }] },
  });
  fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: 'What is thrashing?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

  expect(await screen.findByText('Thrashing is constant page swapping.')).toBeInTheDocument();
  expect(screen.getByText('Page 4')).toBeInTheDocument();
  expect(axios.post).toHaveBeenLastCalledWith(expect.stringMatching(/\/ask$/), {
    docId: 'doc-1', question: 'What is thrashing?', history: [], level: 'simple',
  });

  axios.post.mockResolvedValueOnce({ data: { answer: 'The material does not cover this topic.', found: false, sources: [] } });
  fireEvent.click(screen.getByText('Give me an example'));

  expect(await screen.findByText(/not found in your material/i)).toBeInTheDocument();
  expect(axios.post.mock.calls[2][1].history).toEqual([
    { role: 'student', text: 'What is thrashing?' },
    { role: 'tutor', text: 'Thrashing is constant page swapping.' },
  ]);
});

test('quiz explains a wrong answer, suggests a cause, and offers practice on weak concepts', async () => {
  localStorage.setItem('loggedIn', 'true');
  axios.post.mockReset();
  const question = (q, concept, difficulty) => ({
    q, options: ['FCFS', 'Round Robin'], answer: 'Round Robin', difficulty, concept, explanation: 'Stored explanation.',
  });
  axios.post.mockResolvedValueOnce({
    data: {
      docId: 'doc-1', summary: 'A summary.', notes: [], flashcards: [], warnings: [], knowledge: null, originalText: 'text',
      quiz: [question('Which uses a time quantum?', 'Round Robin', 'easy'), question('Which preempts?', 'Preemption', 'hard')],
    },
  });

  const { container } = render(<App />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'lecture.pdf')] } });
  fireEvent.click(screen.getByText(/generate my study set/i));
  fireEvent.click(await screen.findByText('QUIZ'));

  expect(screen.getByText('easy')).toBeInTheDocument();
  expect(screen.getByText('hard')).toBeInTheDocument();

  // First question wrong, second right
  fireEvent.click(screen.getAllByText('FCFS')[0]);
  fireEvent.click(screen.getAllByText('Round Robin')[2]);

  axios.post.mockResolvedValueOnce({
    data: {
      analysis: [{ index: 0, explanation: 'FCFS has no time quantum.', category: 'knowledge_gap', evidence: 'You picked an unrelated algorithm.', source: 'Page 2' }],
      weakConcepts: [{ name: 'Round Robin', wrong: 1, difficulty: 'easy' }],
    },
  });
  fireEvent.click(screen.getByText('Submit Quiz'));

  expect(screen.getByText('Score: 1 / 2')).toBeInTheDocument();
  expect(await screen.findByText('FCFS has no time quantum.')).toBeInTheDocument();
  expect(screen.getByText(/Knowledge gap - You picked an unrelated algorithm\./)).toBeInTheDocument();
  expect(screen.getByText(/Concepts to work on:/)).toBeInTheDocument();
  expect(axios.post.mock.calls[1][0]).toMatch(/\/analyze-mistakes$/);
  expect(axios.post.mock.calls[1][1].answers).toHaveLength(2);
  expect(axios.post.mock.calls[1][1].answers[0]).toMatchObject({ index: 0, chosen: 'FCFS', answer: 'Round Robin', concept: 'Round Robin' });

  axios.post.mockResolvedValueOnce({ data: { questions: [question('What happens when the quantum expires?', 'Round Robin', 'easy')], concepts: ['Round Robin'] } });
  fireEvent.click(screen.getByText('Practice weak concepts'));

  expect(await screen.findByText(/Practice round on your weak concepts/)).toBeInTheDocument();
  expect(screen.getByText(/What happens when the quantum expires\?/)).toBeInTheDocument();
  expect(screen.queryByText(/Which preempts\?/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Back to full quiz'));
  expect(screen.getByText(/Which preempts\?/)).toBeInTheDocument();
});

test('quiz does not guess a cause when the evidence is unclear', async () => {
  localStorage.setItem('loggedIn', 'true');
  axios.post.mockReset();
  axios.post.mockResolvedValueOnce({
    data: {
      docId: 'doc-2', summary: 'S', notes: [], flashcards: [], warnings: [], knowledge: null,
      quiz: [{ q: 'Which uses a time quantum?', options: ['FCFS', 'Round Robin'], answer: 'Round Robin', difficulty: 'easy', concept: 'Round Robin', explanation: '' }],
    },
  });

  const { container } = render(<App />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'lecture.pdf')] } });
  fireEvent.click(screen.getByText(/generate my study set/i));
  fireEvent.click(await screen.findByText('QUIZ'));
  fireEvent.click(screen.getByText('FCFS'));

  axios.post.mockResolvedValueOnce({ data: { analysis: [{ index: 0, explanation: 'FCFS has no quantum.', category: 'unclear', evidence: '', source: '' }], weakConcepts: [] } });
  fireEvent.click(screen.getByText('Submit Quiz'));

  expect(await screen.findByText(/one wrong answer is not enough to tell why/)).toBeInTheDocument();
});
