#!/usr/bin/env python3
"""
AIMaster Skill Loader — loads and manages Anthropic-format skills (SKILL.md).

Reads skill directories, parses YAML frontmatter, and provides search/list/load
APIs. Skills are stored as Markdown instruction packages compatible with the
open Anthropic Skills format.

Usage:
    from aimaster.skills.loader import SkillLoader

    loader = SkillLoader()
    skills = loader.list_skills()
    skill = loader.get_skill("changelog-generator")
    results = loader.search("changelog")
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class SkillInfo:
    """Metadata and content of a loaded skill."""
    name: str
    description: str
    path: str
    body: str
    has_scripts: bool = False
    has_references: bool = False
    has_assets: bool = False
    license: str = ""
    requires: Dict[str, List[str]] = field(default_factory=dict)


class SkillLoader:
    """Loads and manages Claude-format skills from skills/awesome/ directory."""

    def __init__(self, skills_dir: Optional[str] = None):
        if skills_dir is None:
            skills_dir = os.path.join(os.path.dirname(__file__), "awesome")
        self.skills_dir = Path(skills_dir)
        self._skills: Dict[str, SkillInfo] = {}
        self._loaded = False

    def _ensure_loaded(self):
        if self._loaded:
            return
        self._load_all()
        self._loaded = True

    def _parse_frontmatter(self, text: str) -> tuple:
        lines = text.split("\n")
        metadata = {}
        body_start = 0
        if lines and lines[0].strip() == "---":
            for i in range(1, len(lines)):
                if lines[i].strip() == "---":
                    body_start = i + 1
                    break
                line = lines[i]
                if ":" in line:
                    key, _, value = line.partition(":")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    metadata[key] = value
        body = "\n".join(lines[body_start:]).strip()
        return metadata, body

    def _load_all(self):
        if not self.skills_dir.exists():
            logger.warning(f"Skills directory not found: {self.skills_dir}")
            return
        for entry in sorted(self.skills_dir.iterdir()):
            if not entry.is_dir():
                continue
            skill_md = entry / "SKILL.md"
            if not skill_md.exists():
                continue
            try:
                raw = skill_md.read_text(encoding="utf-8")
                meta, body = self._parse_frontmatter(raw)
                name = meta.get("name", entry.name)
                description = meta.get("description", "")
                requires = {}
                skill = SkillInfo(
                    name=name,
                    description=description,
                    path=str(entry),
                    body=body,
                    has_scripts=(entry / "scripts").exists(),
                    has_references=(entry / "references").exists(),
                    has_assets=(entry / "assets").exists(),
                    license=meta.get("license", ""),
                    requires=requires,
                )
                self._skills[name] = skill
            except Exception as e:
                logger.warning(f"Failed to load skill from {entry}: {e}")
        logger.info(f"Loaded {len(self._skills)} skills from {self.skills_dir}")

    def list_skills(self) -> List[SkillInfo]:
        self._ensure_loaded()
        return sorted(self._skills.values(), key=lambda s: s.name)

    def get_skill(self, name: str) -> Optional[SkillInfo]:
        self._ensure_loaded()
        if name in self._skills:
            return self._skills[name]
        name_lower = name.lower()
        for key, skill in self._skills.items():
            if key.lower() == name_lower:
                return skill
        for key, skill in self._skills.items():
            if name_lower in key.lower():
                return skill
        return None

    def search(self, query: str) -> List[SkillInfo]:
        self._ensure_loaded()
        query_lower = query.lower()
        results = []
        for skill in self._skills.values():
            if query_lower in skill.name.lower() or query_lower in skill.description.lower():
                results.append(skill)
        return sorted(results, key=lambda s: s.name)

    def count(self) -> int:
        self._ensure_loaded()
        return len(self._skills)

    def reload(self):
        self._skills.clear()
        self._loaded = False
        self._ensure_loaded()
