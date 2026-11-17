import { describe, expect, it } from 'vitest';
import { calculateInternLevel, createNewInternProfile, promoteGraduatedIntern, skillsFor, specialtyMeta } from '../../src/engine/internshipSystem';

describe('calculateInternLevel', () => {
  it('maps xp to levels and graduation eligibility', () => {
    expect(calculateInternLevel(0).level).toBe(1);
    expect(calculateInternLevel(120).level).toBe(3);
    expect(calculateInternLevel(250).graduationEligible).toBe(true);
  });
});

describe('custom specialties', () => {
  it('resolves built-ins and falls back to the chosen base role', () => {
    expect(specialtyMeta('QA').role).toBe('qa');
    expect(specialtyMeta('IoT & Embedded', 'architect').role).toBe('architect');
    expect(specialtyMeta('IoT & Embedded').role).toBe('backend');
  });

  it('builds a generic study track for custom specialties', () => {
    expect(skillsFor('IoT & Embedded')).toHaveLength(5);
    expect(skillsFor('Frontend')[0]).toBe('Reactive State Synchronization');
  });

  it('puts the focus in the system prompt and graduates into the base role', () => {
    const intern = createNewInternProfile({ name: 'Volt', specialty: 'IoT & Embedded', baseRole: 'backend', focus: 'MQTT and sensors', mentorId: 'm1' }, 0);
    expect(intern.systemPrompt).toContain('MQTT and sensors');
    expect(intern.internship?.baseRole).toBe('backend');
    const grown = promoteGraduatedIntern(intern);
    expect(grown.role).toBe('backend');
    expect(grown.title).toBe('Autonomous IoT & Embedded Specialist');
  });
});
