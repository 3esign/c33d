import React from 'react';
import { 
  Box, 
  Layers, 
  Sparkles, 
  GitBranch, 
  Sliders 
} from 'lucide-react';
import type { GroupIntention } from '../store/types';

export const INTENTION_CONFIG: Record<GroupIntention, {
  label: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  bgGradient: string;
  icon: React.FC<{ size?: number; className?: string }>;
  description: string;
}> = {
  part: {
    label: 'PART',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    badgeText: 'text-cyan-400',
    borderColor: 'border-cyan-500/40 hover:border-cyan-500/60',
    bgGradient: 'bg-gradient-to-b from-cyan-950/20 to-slate-950/30',
    icon: Box,
    description: 'Single functional part',
  },
  assembly: {
    label: 'ASSEMBLY',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    badgeText: 'text-emerald-400',
    borderColor: 'border-emerald-500/40 hover:border-emerald-500/60',
    bgGradient: 'bg-gradient-to-b from-emerald-950/20 to-slate-950/30',
    icon: Layers,
    description: 'Compound sub-assembly',
  },
  idea: {
    label: 'IDEA',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    badgeText: 'text-purple-400',
    borderColor: 'border-purple-500/40 hover:border-purple-500/60',
    bgGradient: 'bg-gradient-to-b from-purple-950/20 to-slate-950/30',
    icon: Sparkles,
    description: 'Conceptual exploration',
  },
  skeleton: {
    label: 'SKELETON',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    badgeText: 'text-amber-400',
    borderColor: 'border-amber-500/40 hover:border-amber-500/60',
    bgGradient: 'bg-gradient-to-b from-amber-950/20 to-slate-950/30',
    icon: GitBranch,
    description: 'Driving curves & points',
  },
  driver: {
    label: 'DRIVER',
    badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    badgeText: 'text-rose-400',
    borderColor: 'border-rose-500/40 hover:border-rose-500/60',
    bgGradient: 'bg-gradient-to-b from-rose-950/20 to-slate-950/30',
    icon: Sliders,
    description: 'Parameters & controls',
  },
};