# MemRL
Introduced as *Runtime Continous Non-Parametric Reinforcement Learning* technique **Memory Re-inforced Learning** is goldengate to ***continously*** teach your agent about accuracy of choosen skill, tools or memory base on the feedback from *achived outcome* with keeping LLM in initial **Frozen Wieghts State** (known as *BlackBox*). _**MemRL** base on human cognition hallmark that's learning from experiences_ e.g: you used some words in CV and you were choosen to next stage. In RavenADK it's represent as the extended version paired with tools, skills and memory used by [**ReAct Agent**](../ReAct-Agent.md)

> **MemRL** in its fundations implementation at RavenADK base on the arXiv Research Paper [MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on
Episodic Memory](https://arxiv.org/pdf/2601.03192)
> **MemRL** resolves the RAG problem that suffers from the **semantic-noise** (A past experience might use the exact same keywords or look almost identical to the current task, but contain a flawed strategy that leads to failure. Passive retrieval gets fooled by these "distractors.")
> <br><br>It comes with cost since MemRL requires embedding generation out of user query and updation of Q-Score after action
> **!Imporant:** MemRL Requires to use some Embedding Model and **VectorDB**

![alt text](./images/memrl.png)

## Concepts
- **Q-Score** - describes usability of memroy rememebred information like skill or method. This is the score assigned from feedback like user feedback and it represents the rembered information as usefull or not. It acts as the critique for initial semanitc retrival
- **Monte-Carlo-Tree-Search** - is used to show user the known solution and not-known with `UCB1` as the algorithm manages boundary dividing explotation from exploration. Agent use this to decide whether to use the known solution or give unknown
- **Intent-Experience-Utility** - is `triplet` describes how agent rememebers the information
    - Intent - It's the task embedding or task itself
    - Experience - Action/task trace
    - Utility - $Q-value$ updated via Reinformcement Runtime Feedback
- **Two-Phase-Retrival** - selects experiences based on their learned Q-values and ector Similarity (with Distance Metric), reflecting expected utility, rather than semantic similarity alone
    * 1st Phase - Similarity Recall - base on Vector similarity finds the $top-K$ memory candidates from VectorDB like Pinecone or ChromaDB
    * 2nd Phase - Utility aware selection - base on Q-score measures candidates by blending similarity with learned Q-values (Utility) using the *weighting factor* ($\lambda$). Finds the best candidate from `top-K out of 1st Phase` base on what deliveried the best job on side and passes to 3rd phase where is LLM. Formula:
    $$\text{Score}(m) = (1 - \lambda) \cdot \text{Similarity}(m) + \lambda \cdot Q(m)$$
    * | Out of Retrival | 3rd phase - retrived memory is combined with user query and given context -> base on this llm produces output
- **Non-parametric Runtime Reinforcement Learning** - As authors of original arXiv papers says **MemRL** "method frames memory usage as a learnable decision problem and applies `non-parametric` reinforcement learning on
memory to bypass the risk"
- **Feedback Driven** / **Self-augmented `updates`** - user gives feedback or as choosen agent (like ReAct Agent) is deployed to make self-augmented raiting (usefull when you've option to ask user or it's to much costfull), such self-augmentic agent can measure the usability base on user behaviour <!-- TODO: Leave the agent as open gate from where user can define his own handler like `AI-Workflow` that will measure user behaviour or one that is ReAct Agent from RavenADK -->
- **Memory Retrival Policy** - switches passive match to an active decision process base on **value** effectively accounting for the functional utility of
$m$ in generating successful outcomes $at$. MemRL Agent updates the memory retrival policy instead of weights to maximize the retrival of the best Q-score utils
- **Fronzen LLM** - the weights of llm stays unchanged because this technique relies on auto-evolving with time
- **Semantic-Noise of RAG** - RAG has data but hasn't got the measurement of how particular data was good. MemRL stores this ranking for re-ranking top-k candidates according to usability of memory for specified task is wapped as embedding
- **MEMRL learns an optimal retrieval policy** - MemRL learns the best policy $µ∗$ that maximizes the **utility score**<br>
$µ
∗
(m|s,M) = arg max
m∈M
Q(s, m)$

## Math Groundenss
$π(x`|st,Mt) = X
m∈Mt
µ(m|st,Mt)pLLM(at|st, m).$

#### where
- $µ(m|st,Mt)$ - is the **Retrieval Policy** for retriving the memory contexts
- $pLLM(at|st, m)$ - is the **Inference Policy** parametrized by a frozen LLM


> **MemRL** - transforms retrieval from a passive match into an active decision
process, effectively accounting for the functional utility of
m in generating successful outcomes $at$ <br/><br/>
> "In previous RAG or memory-based agentic paradigms, the
retrieval policy $µ$ is usually determined by a fixed vector similarity metric, e.g., cosine similarity of embeddings. While
effective for semantic matching, such policies fail to account for the utility of a memory, i.e., whether retrieving m
actually leads to a successful outcome at." **TL;DR:** **RAG** accounts search for similarity (Cosine, Suqared L2 or Dot Product) but doesn't as default for usefullness that comes in **MemRL** as reflection from took action usefulness and further retrival via `retrival-measurement-update` base on **Intent-Experience-Utility** `triplet`
> * This makes MemRL incredibly usefull to measure the usefulness of memory, skills and more
> * MemRL can be used to improve the stored memory for better future request - as user or llm gives feedback the memory can be refined to have better meaning in future

## Usability <!-- TODO: Use as the scratchpad for making the MemRL -->
- Use in pair with skills to allow agent to remember how usefull was particular skill for future (Q-Score) of skill will be improved
> Usage with skills infuences to use the Rag engine to wrap each skill since 1st phase alwasy base on the vector semantic lookup
- Use in pair with memory system to remember the usefullness of memory
- Use to allow agent to learn from either success'es and failure's
- Use with **RAG** storage to keept the Q-Scores for the achived informations to measure its usability for particular tasks with either self-augmenting or from user feedback
- Reward - reward relies on taken memory and result of action that based on that memory - it's inherited from **Reinforcement Learning from Machine Learning**