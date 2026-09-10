import axios from 'axios';

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // TODO: delegar al flujo de autenticación común cuando exista (redirect a /login).
    }
    return Promise.reject(error);
  },
);
