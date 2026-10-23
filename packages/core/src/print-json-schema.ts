import { z } from 'zod';
import { LessonInput } from './lesson.ts';

// Prints the JSON Schema of the lesson input format (docs/lesson.schema.json is generated from this).
const schema = z.toJSONSchema(LessonInput, { io: 'input' });
process.stdout.write(
  JSON.stringify(
    {
      $id: 'https://github.com/predantsev/piano-steps/blob/main/docs/lesson.schema.json',
      title: 'piano-steps lesson (input)',
      ...schema,
    },
    null,
    2,
  ) + '\n',
);
