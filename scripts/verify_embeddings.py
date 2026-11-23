#!/usr/bin/env python3
"""Compare the app's fixed multilingual-e5-small test phrases with Transformers."""

import json

import torch
import torch.nn.functional as functional
from transformers import AutoModel, AutoTokenizer


MODEL_NAME = "intfloat/multilingual-e5-small"
MAX_LENGTH = 512
PHRASES = [
    "query: как настроить локальный поиск на телефоне",
    "passage: полнотекстовый поиск SQLite FTS5 и векторные эмбеддинги работают офлайн на Android",
    "passage: рецепт тонких блинов на молоке с яйцами и мукой",
    "query: offline semantic search mobile database",
]


def main() -> None:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModel.from_pretrained(MODEL_NAME)
    model.eval()

    vectors: list[torch.Tensor] = []
    with torch.inference_mode():
        for index, phrase in enumerate(PHRASES, start=1):
            encoded = tokenizer(
                phrase,
                truncation=True,
                max_length=MAX_LENGTH,
                return_tensors="pt",
            )
            print(f"phrase {index}: {phrase}")
            print(f"input_ids: {json.dumps(encoded['input_ids'][0].tolist())}")

            output = model(**encoded).last_hidden_state
            mask = encoded["attention_mask"].unsqueeze(-1).to(output.dtype)
            pooled = (output * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
            vectors.append(functional.normalize(pooled, p=2, dim=1)[0])

    similarities = (
        (1, 2),
        (1, 3),
        (4, 2),
    )
    for left, right in similarities:
        similarity = functional.cosine_similarity(
            vectors[left - 1].unsqueeze(0),
            vectors[right - 1].unsqueeze(0),
        ).item()
        print(f"sim({left}, {right}): {similarity:.6f}")


if __name__ == "__main__":
    main()
