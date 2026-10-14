# Resumo de Gestão Inteligente

`GET /admin/insights?mes=AAAA-MM` devolve, para o gestor da clínica (perfil `CLINICA`), um
resumo de **até 3 linhas** comparando agendamentos e cancelamentos do mês com o anterior.

```json
{
  "mes": "2026-10",
  "resumo": [
    "Foram 70 agendamentos e 28 cancelamentos (taxa de 40%, +12% de cancelamentos em relação ao mês anterior).",
    "Este mês houve um aumento de 15% em cancelamentos na especialidade Cardiologia.",
    "Sugerimos revisar a escala de médicos de Cardiologia."
  ],
  "origem": "simulado",
  "metricas": { "...": "totais e comparativo por especialidade" }
}
```

`origem`: `llm` (Claude), `simulado` (mock, sem chave) ou `regras` (plano B quando a LLM falha).

## Configuração

| Variável | Efeito |
|---|---|
| `INSIGHTS_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | usa o Claude de verdade. Sem a chave, cai no mock e avisa no log. |
| `INSIGHTS_LLM_MODEL` | troca o modelo (padrão `claude-opus-5-5`; ex.: `claude-haiku-5-5` para custo menor) |
| *(nada)* | provedor simulado: resumo por regras, sem rede |

## Fluxo

`insightsRepositorio` (lê data, motivo de cancelamento e especialidade) →
`insightsAnalise` (métricas agregadas) → `insightsServico` → provedor (`insightsLLM`) →
`insightsSaneamento` (texto puro, máx. 3 linhas) → resposta.

## Segurança e privacidade

- **Só o perfil CLINICA** acessa; `mes` é validado (AAAA-MM, de 36 meses atrás até o mês atual).
- **LGPD:** a LLM recebe apenas contagens por especialidade. Paciente, CPF, e-mail e ids nunca
  entram no registro analisado.
- **Prompt injection:** o nome da especialidade é cadastro livre e vai ao prompt. Só passa texto
  curto (letras, até 4 palavras, sem quebra de linha); o resto vira "Outras". As instruções ficam
  no `system` e os números em `<dados>`, tratados como informação.
- **Saída da LLM** é tratada como não confiável: sem HTML, markdown, links ou caracteres de
  controle, no máximo 3 linhas.
- **Custo e disponibilidade:** resumo em cache por 5 minutos por mês, LLM não é chamada sem dados,
  timeout de 15 s e 1 retry. Qualquer falha (erro, recusa, timeout, texto inválido) devolve o
  resumo por regras, nunca um 500.

## Cancelamento lógico

`DELETE /consulta/:id` **não apaga mais** a consulta: preenche `canceladaEm` (data/hora) e
`motivoCancelamento` (`paciente_desistiu`, `médico_cancelou` ou `outros`; se o corpo não trouxer
motivo, assume o padrão do perfil que cancelou). Uma consulta está cancelada quando `canceladaEm`
está preenchido, e é isso que o relatório conta.

Para o usuário nada muda: a consulta cancelada some de `GET /consulta`, `GET /consulta/:id` e
`GET /paciente/:id/consultas`, e o horário volta a ficar livre para novos agendamentos.

## Limitações

- A análise usa a **data da consulta**, não a data em que foi marcada ou cancelada. A data do
  cancelamento (`canceladaEm`) já é gravada e pode alimentar uma análise futura de antecedência.
- Cancelamentos feitos **antes** desta mudança foram apagados e não aparecem no histórico.
- A coluna nova `cancelada_em` é criada automaticamente porque o projeto usa `synchronize: true`.
  Em ambiente com `synchronize` desligado, é preciso uma migration.
