# Pantanal Clima (GitHub Pages)

Plataforma **estática** (HTML/CSS/JS) para explorar séries climáticas do Pantanal com:

- Séries temporais (mensal/anual) com bandas (min–max, ±1 sd) e suavização (média móvel);
- Estatística descritiva (média, mediana, sd, quantis, min/max);
- Tendência **robusta**: Mann–Kendall (tau, z, p) + inclinação de Sen + regressão linear (R²);
- Comparação entre variáveis: dispersão + correlação (Pearson/Spearman) + matriz de correlação;
- Compartilhamento de link com filtros (URL query string) e exportação do recorte filtrado (CSV).

## Estrutura

- `index.html`
- `styles.css`
- `app.js`
- `data/pantanal_clima_utf8.csv` (CSV em UTF-8)

## Publicar no GitHub Pages

1. Crie um repositório (ex: `pantanal-clima`).
2. Envie os arquivos para a raiz do repositório.
3. Em **Settings → Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main` / root
4. Acesse a URL do Pages.

## Notas de performance

O dataset atual (~27k linhas) roda bem no navegador.  
Se crescer muito (centenas de milhares/milhões de linhas), a evolução natural é:
- pré-agregar por ano/município (gerar CSVs menores por variável),
- ou publicar em parquet + DuckDB-WASM,
- ou usar uma API simples (Cloudflare Workers / FastAPI) com cache.

## Créditos
Feito para uso acadêmico e divulgação científica.
