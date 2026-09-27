"use client";

import { useState } from "react";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { TextInput } from "@/components/text-input";

import type { ContributorLink } from "./actions";

export type ContributorOption = { id: string; display_name: string; contributor_type: string };

export function ContributorLinker({
  options,
  links,
  onChange,
}: {
  options: ContributorOption[];
  links: ContributorLink[];
  onChange: (links: ContributorLink[]) => void;
}) {
  const [selectedContributorId, setSelectedContributorId] = useState("");
  const [role, setRole] = useState("");

  const handleAdd = () => {
    if (!selectedContributorId || !role.trim()) {
      return;
    }
    onChange([...links, { contributorId: selectedContributorId, role: role.trim() }]);
    setSelectedContributorId("");
    setRole("");
  };

  const handleRemove = (index: number) => {
    onChange(links.filter((_, i) => i !== index));
  };

  const optionsById = new Map(options.map((option) => [option.id, option]));

  return (
    <div className="flex flex-col gap-2">
      <span>Contributors</span>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((link, index) => (
            <li
              key={`${link.contributorId}-${link.role}-${index}`}
              className="flex items-center gap-2"
            >
              <span>
                {optionsById.get(link.contributorId)?.display_name ?? link.contributorId} —{" "}
                {link.role}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="text-sm text-red-700 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Select
          value={selectedContributorId}
          onChange={(e) => setSelectedContributorId(e.target.value)}
        >
          <option value="">Select a contributor</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.display_name} ({option.contributor_type})
            </option>
          ))}
        </Select>
        <TextInput
          placeholder="Role (e.g. narrator)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <Button type="button" variant="secondary" onClick={handleAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}
