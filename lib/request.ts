import { trimValues, queryStringify } from 'taomu-toolkit'

import { RequestStatus } from './defines'
import { getRequestDefaultOptions, requestHooks } from './config'
import { errorHandler } from './handler'

const REG_IS_URL = /^(https?:)?\/\/.+$/

/**
 * 发起一个网络请求，使用 [JavaScript Fetch API](https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API)
 *
 * @param path 请求路径，如果不是绝对路径，自动补全 baseURL
 * @param params 请求参数
 * @param optionsSource 请求选项
 * @returns
 */
export async function request<T extends RequestRes, P>(
  path: string,
  paramsSource?: P,
  optionsSource?: RequestOptions
): Promise<T> {
  const controller = new AbortController() // Promise 阻断控制器
  const options: RequestOptions = Object.assign(getRequestDefaultOptions(), optionsSource)
  const {
    baseURL,
    method,
    checkStatus,
    formData,
    handleErrors,
    headers: headersObj = {},
    addTimeStamp,
    timeout,
    withCredentials,
    defaultParams = {},
    trimParams,
    useQueryParams,
    deleteUndefinedParams,
    successCode = RequestStatus.成功,
    ...fetchOptions
  } = options

  // 参数处理，移除字符串两端空格 & 删除 undefined 字段
  const params = trimValues(paramsSource, trimParams, deleteUndefinedParams)

  // 请求头
  const headers = new Headers(headersObj)

  if (!Object.prototype.hasOwnProperty.call(headersObj, 'Content-Type')) {
    headers.append('Content-Type', formData ? 'multipart/form-data' : 'application/json;charset=utf-8')
  }

  if (!fetchOptions.credentials) {
    fetchOptions.credentials = withCredentials ? 'include' : 'omit'
  }

  if (addTimeStamp) {
    defaultParams.t = Date.now()
  }

  const sendData: RequestSendData = {
    path,
    url: REG_IS_URL.test(path) ? path : `${baseURL}${path}`,
    method,
    headers,
    signal: controller.signal,
    ...fetchOptions,
  }

  const paramsData = Object.assign({}, defaultParams, params)

  if (useQueryParams || ['GET', 'HEAD'].includes(method!.toUpperCase())) {
    const paramsStr = queryStringify(paramsData, true)
    sendData.url = sendData.url + paramsStr
  } else if (formData) {
    const formData = new FormData()
    Object.keys(paramsData).forEach((key) => {
      formData.append(key, paramsData[key])
    })
    sendData.body = formData
  } else {
    sendData.body = JSON.stringify(paramsData)
  }

  // 超时控制
  let timer: NodeJS.Timeout | null = null
  if (timeout) {
    timer = setTimeout(() => {
      controller.abort()
    }, timeout)
  }

  let beforeRes: any = undefined
  if (requestHooks.beforeRequest) {
    beforeRes = await requestHooks.beforeRequest(sendData, options)
  }

  let resData: T = {} as T

  await fetch(sendData.url, sendData)
    .then(async (res) => {
      let data: T = {} as T

      try {
        data = await res.json()
      } catch (err) {
        data.raw = await res.text().catch(() => '')
        data.code = RequestStatus.数据格式异常
        data.message = '返回数据不是JSON格式'
      }

      if (!res.ok && !data.code) {
        // data.code = res.status
        data.code = RequestStatus.状态码异常
        data.message = `${data.message} 错误代码:${res.status}`
      }

      resData = data

      if (requestHooks.checkStatus) {
        return requestHooks.checkStatus(data, sendData, options)
      } else if (!checkStatus || data.code == successCode) {
        return data
      }

      return Promise.reject(data)
    })
    .catch((err) => {
      let errH = err

      if (typeof err !== 'object') {
        errH = {
          message: err,
        }
      }

      resData = errH

      if (handleErrors) {
        return errorHandler<T>(errH, sendData, options)
      } else {
        return Promise.resolve(errH)
      }
    })
    .finally(() => {
      if (requestHooks.afterRequest) {
        return requestHooks.afterRequest(beforeRes, resData, sendData, options)
      }
    })

  if (timer) {
    clearTimeout(timer)
  }

  return resData
}